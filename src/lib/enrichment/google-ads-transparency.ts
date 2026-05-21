import { db } from "@/lib/db";
import {
  installers,
  googleAdsData,
  trafficData,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { RateLimiter } from "./rate-limiter";

const BASE_URL = "https://api.dataforseo.com/v3";

function getAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DATAFORSEO credentials not set");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

// Single installer lookup
export async function fetchGoogleAdsTransparency(installerId: number): Promise<{ result?: Record<string, unknown>; error?: string }> {
  const auth = getAuth();

  const [inst] = await db
    .select({ website: installers.website })
    .from(installers)
    .where(eq(installers.id, installerId))
    .limit(1);

  if (!inst?.website) return { error: "No website URL" };

  const domain = inst.website.startsWith("http")
    ? new URL(inst.website).hostname.replace(/^www\./, "")
    : inst.website.replace(/^www\./, "");

  // Use the live/advanced endpoint (this one has a /live variant)
  const res = await fetch(`${BASE_URL}/serp/google/ads_search/live/advanced`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([{
      target: domain,
      location_name: "United Kingdom",
      language_name: "English",
      depth: 40,
    }]),
  });

  const data = await res.json();
  if (data.status_code !== 20000) return { error: `API error ${data.status_code}: ${data.status_message}` };

  const task = data.tasks?.[0];
  if (task?.status_code !== 20000 && task?.status_code !== 40102) {
    return { error: `Task error ${task?.status_code}: ${task?.status_message}` };
  }

  const items = task?.result?.[0]?.items || [];

  // Count ad types
  let textAds = 0, imageAds = 0, videoAds = 0;
  const platforms = new Set<string>();
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  const sampleTitles: string[] = [];
  let advertiserId: string | null = null;
  let advertiserName: string | null = null;
  let isVerified = false;

  for (const item of items) {
    if (item.format === "text") textAds++;
    else if (item.format === "image") imageAds++;
    else if (item.format === "video") videoAds++;

    if (item.advertiser_id && !advertiserId) {
      advertiserId = item.advertiser_id;
      advertiserName = item.title || null;
      isVerified = item.verified || false;
    }

    if (item.first_shown) {
      if (!firstSeen || item.first_shown < firstSeen) firstSeen = item.first_shown;
    }
    if (item.last_shown) {
      if (!lastSeen || item.last_shown > lastSeen) lastSeen = item.last_shown;
    }

    if (sampleTitles.length < 5 && item.title) {
      sampleTitles.push(item.title);
    }
  }

  // Store
  await db.delete(googleAdsData).where(eq(googleAdsData.installerId, installerId));
  await db.insert(googleAdsData).values({
    installerId,
    advertiserId,
    advertiserName,
    isVerified,
    totalAds: items.length,
    textAds,
    imageAds,
    videoAds,
    platforms: platforms.size > 0 ? JSON.stringify(Array.from(platforms)) : null,
    firstAdSeen: firstSeen,
    lastAdSeen: lastSeen,
    sampleAdTitles: sampleTitles.length > 0 ? JSON.stringify(sampleTitles) : null,
    fetchedAt: new Date().toISOString(),
  });

  return {
    result: {
      totalAds: items.length,
      textAds,
      imageAds,
      videoAds,
      advertiserName,
      isVerified,
      domain,
    },
  };
}

// Batch enrichment with optional traffic filter
export async function enrichGoogleAdsBatch(jobId: number, minTraffic = 0) {
  const auth = getAuth();

  let query;
  if (minTraffic > 0) {
    // Only process installers above the traffic threshold
    query = db
      .select({ id: installers.id, website: installers.website })
      .from(installers)
      .leftJoin(googleAdsData, eq(installers.id, googleAdsData.installerId))
      .leftJoin(trafficData, eq(installers.id, trafficData.installerId))
      .where(sql`${googleAdsData.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != '' AND ${trafficData.googleOrganicEtv} >= ${minTraffic}`);
  } else {
    query = db
      .select({ id: installers.id, website: installers.website })
      .from(installers)
      .leftJoin(googleAdsData, eq(installers.id, googleAdsData.installerId))
      .where(sql`${googleAdsData.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`);
  }

  const toEnrich = await query;

  await db.update(enrichmentJobs).set({
    totalItems: toEnrich.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let processed = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Process in parallel batches of 10
  for (let i = 0; i < toEnrich.length; i += 10) {
    const batch = toEnrich.slice(i, i + 10).filter((inst) => inst.website);

    const results = await Promise.allSettled(
      batch.map(async (inst) => {
      const website = inst.website!;
      const domain = website.startsWith("http")
        ? new URL(website).hostname.replace(/^www\./, "")
        : website.replace(/^www\./, "");

      const res = await fetch(`${BASE_URL}/serp/google/ads_search/live/advanced`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([{
          target: domain,
          location_name: "United Kingdom",
          language_name: "English",
          depth: 20,
        }]),
      });

      const data = await res.json();
      if (data.status_code !== 20000) throw new Error(`API ${data.status_code}: ${data.status_message}`);

      const task = data.tasks?.[0];
      // 40102 = no results (company doesn't run Google Ads) - that's a valid result
      if (task?.status_code !== 20000 && task?.status_code !== 40102) {
        throw new Error(`Task ${task?.status_code}: ${task?.status_message}`);
      }

      const items = task?.result?.[0]?.items || [];
      let textAds = 0, imageAds = 0, videoAds = 0;
      const batchPlatforms = new Set<string>();
      let batchFirstSeen: string | null = null;
      let batchLastSeen: string | null = null;
      const batchTitles: string[] = [];
      let batchAdvId: string | null = null;
      let batchAdvName: string | null = null;
      let batchVerified = false;

      for (const item of items) {
        if (item.format === "text") textAds++;
        else if (item.format === "image") imageAds++;
        else if (item.format === "video") videoAds++;
        if (item.platform) batchPlatforms.add(item.platform);
        if (item.first_shown && (!batchFirstSeen || item.first_shown < batchFirstSeen)) batchFirstSeen = item.first_shown;
        if (item.last_shown && (!batchLastSeen || item.last_shown > batchLastSeen)) batchLastSeen = item.last_shown;
        if (batchTitles.length < 5 && item.title) batchTitles.push(item.title);
        if (item.advertiser_id && !batchAdvId) { batchAdvId = item.advertiser_id; batchAdvName = item.title || null; batchVerified = item.verified || false; }
      }

      // Check for existing record to avoid duplicates
      const existing = await db.select({ id: googleAdsData.id }).from(googleAdsData).where(eq(googleAdsData.installerId, inst.id)).limit(1);
      if (existing.length > 0) return;

      await db.insert(googleAdsData).values({
        installerId: inst.id,
        advertiserId: batchAdvId,
        advertiserName: batchAdvName,
        isVerified: batchVerified,
        totalAds: items.length,
        textAds, imageAds, videoAds,
        platforms: batchPlatforms.size > 0 ? JSON.stringify(Array.from(batchPlatforms)) : null,
        firstAdSeen: batchFirstSeen,
        lastAdSeen: batchLastSeen,
        sampleAdTitles: batchTitles.length > 0 ? JSON.stringify(batchTitles) : null,
        fetchedAt: new Date().toISOString(),
      });
    })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        processed++;
      } else {
        processed++;
        errors++;
        errorLog.push(r.reason?.message || String(r.reason));
      }
    }

    await db.update(enrichmentJobs).set({ processedItems: processed, errorCount: errors }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: processed, errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}
