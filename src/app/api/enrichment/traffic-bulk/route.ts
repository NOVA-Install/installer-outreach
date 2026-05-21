import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, trafficData, enrichmentJobs } from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

export async function POST() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    return NextResponse.json({ error: "DATAFORSEO credentials not set" }, { status: 500 });
  }

  const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");

  // Find installers without traffic data that have a website
  const toEnrich = await db
    .select({ id: installers.id, website: installers.website })
    .from(installers)
    .leftJoin(trafficData, eq(installers.id, trafficData.installerId))
    .where(sql`${trafficData.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`);

  // Create enrichment job
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      type: "traffic_bulk",
      status: "running",
      totalItems: toEnrich.length,
      processedItems: 0,
      errorCount: 0,
      startedAt: new Date().toISOString(),
    })
    .returning();

  if (toEnrich.length === 0) {
    await db.update(enrichmentJobs).set({
      status: "completed",
      completedAt: new Date().toISOString(),
    }).where(eq(enrichmentJobs.id, job.id));
    return NextResponse.json({ jobId: job.id, status: "completed", message: "No installers need traffic data" });
  }

  // Extract domains
  const domainMap = new Map<string, number>(); // domain → installerId
  for (const inst of toEnrich) {
    if (!inst.website) continue;
    try {
      const domain = inst.website.startsWith("http")
        ? new URL(inst.website).hostname.replace(/^www\./, "")
        : inst.website.replace(/^www\./, "");
      domainMap.set(domain, inst.id);
    } catch {
      // skip invalid URLs
    }
  }

  const domains = Array.from(domainMap.keys());
  let processed = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Batch in groups of 1000 (API limit)
  for (let i = 0; i < domains.length; i += 1000) {
    const batch = domains.slice(i, i + 1000);

    try {
      // Google traffic
      const googleRes = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_traffic_estimation/live", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([{
          targets: batch,
          location_name: "United Kingdom",
          language_name: "English",
          item_types: ["organic", "paid", "featured_snippet", "local_pack"],
        }]),
      });

      const googleData = await googleRes.json();
      if (googleData.status_code !== 20000) {
        throw new Error(`Google API error ${googleData.status_code}: ${googleData.status_message}`);
      }

      // Bing traffic
      const bingRes = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/bing/bulk_traffic_estimation/live", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([{
          targets: batch,
          location_name: "United Kingdom",
          language_name: "English",
          item_types: ["organic", "paid"],
        }]),
      });

      const bingData = await bingRes.json();

      // Process Google results
      const googleItems = googleData?.tasks?.[0]?.result?.[0]?.items || [];
      const bingItems = bingData?.tasks?.[0]?.result?.[0]?.items || [];

      // Index bing by target
      const bingByTarget = new Map<string, { metrics?: { organic?: { etv?: number; count?: number }; paid?: { etv?: number; count?: number } }; target?: string }>();
      for (const item of bingItems) {
        if (item.target) bingByTarget.set(item.target, item);
      }

      for (const gItem of googleItems) {
        const domain = gItem.target;
        const instId = domainMap.get(domain);
        if (!instId) continue;

        const bItem = bingByTarget.get(domain);

        await db.insert(trafficData).values({
          installerId: instId,
          googleOrganicEtv: gItem.metrics?.organic?.etv ?? null,
          googleOrganicCount: gItem.metrics?.organic?.count ?? null,
          googleOrganicTrafficCost: null,
          googlePaidEtv: gItem.metrics?.paid?.etv ?? null,
          googlePaidCount: gItem.metrics?.paid?.count ?? null,
          googlePaidTrafficCost: null,
          googleFeaturedSnippetEtv: gItem.metrics?.featured_snippet?.etv ?? null,
          googleLocalPackEtv: gItem.metrics?.local_pack?.etv ?? null,
          googleOrganicPos1: null,
          googleOrganicPos2_3: null,
          googleOrganicPos4_10: null,
          googleOrganicPos11_20: null,
          googleOrganicIsNew: null,
          googleOrganicIsUp: null,
          googleOrganicIsDown: null,
          googleOrganicIsLost: null,
          googlePaidPos1: null,
          googlePaidPos2_3: null,
          googlePaidPos4_10: null,
          bingOrganicEtv: bItem?.metrics?.organic?.etv ?? null,
          bingOrganicCount: bItem?.metrics?.organic?.count ?? null,
          bingPaidEtv: bItem?.metrics?.paid?.etv ?? null,
          bingPaidCount: bItem?.metrics?.paid?.count ?? null,
          source: "bulk",
          fetchedAt: new Date().toISOString(),
        });

        processed++;
      }
    } catch (err) {
      errors++;
      errorLog.push(err instanceof Error ? err.message : String(err));
    }

    await db.update(enrichmentJobs).set({
      processedItems: processed,
      errorCount: errors,
    }).where(eq(enrichmentJobs.id, job.id));
  }

  await db.update(enrichmentJobs).set({
    processedItems: processed,
    errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, job.id));

  return NextResponse.json({ jobId: job.id, status: "completed", processed, errors });
}
