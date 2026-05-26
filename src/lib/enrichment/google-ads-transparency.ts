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

// ─── Shared parsing for Google Ads items ───

interface ParsedGoogleAds {
  totalAds: number;
  textAds: number;
  imageAds: number;
  videoAds: number;
  platforms: string | null;
  firstAdSeen: string | null;
  lastAdSeen: string | null;
  sampleAdTitles: string | null;
  advertiserId: string | null;
  advertiserName: string | null;
  isVerified: boolean;
}

function parseGoogleAdsItems(items: Record<string, unknown>[]): ParsedGoogleAds {
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

    if (item.platform) platforms.add(item.platform as string);

    if (item.advertiser_id && !advertiserId) {
      advertiserId = item.advertiser_id as string;
      advertiserName = (item.title || null) as string | null;
      isVerified = (item.verified || false) as boolean;
    }

    if (item.first_shown) {
      const fs = item.first_shown as string;
      if (!firstSeen || fs < firstSeen) firstSeen = fs;
    }
    if (item.last_shown) {
      const ls = item.last_shown as string;
      if (!lastSeen || ls > lastSeen) lastSeen = ls;
    }

    if (sampleTitles.length < 5 && item.title) sampleTitles.push(item.title as string);
  }

  return {
    totalAds: items.length,
    textAds, imageAds, videoAds,
    platforms: platforms.size > 0 ? JSON.stringify(Array.from(platforms)) : null,
    firstAdSeen: firstSeen,
    lastAdSeen: lastSeen,
    sampleAdTitles: sampleTitles.length > 0 ? JSON.stringify(sampleTitles) : null,
    advertiserId, advertiserName, isVerified,
  };
}

// ─── Single installer lookup ───

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
  const parsed = parseGoogleAdsItems(items);

  const adsValues = { installerId, ...parsed, fetchedAt: new Date().toISOString() };
  await db.insert(googleAdsData).values(adsValues)
    .onConflictDoUpdate({ target: googleAdsData.installerId, set: adsValues });

  return {
    result: {
      totalAds: parsed.totalAds,
      textAds: parsed.textAds,
      imageAds: parsed.imageAds,
      videoAds: parsed.videoAds,
      advertiserName: parsed.advertiserName,
      isVerified: parsed.isVerified,
      domain,
    },
  };
}

// ─── Batch enrichment with optional traffic filter ───

export async function enrichGoogleAdsBatch(jobId: number, minTraffic = 0) {
  const auth = getAuth();

  let query;
  if (minTraffic > 0) {
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
    const [currentJob] = await db.select({ status: enrichmentJobs.status }).from(enrichmentJobs).where(eq(enrichmentJobs.id, jobId)).limit(1);
    if (currentJob?.status === "cancelled") break;

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
        if (task?.status_code !== 20000 && task?.status_code !== 40102) {
          throw new Error(`Task ${task?.status_code}: ${task?.status_message}`);
        }

        const items = task?.result?.[0]?.items || [];
        const parsed = parseGoogleAdsItems(items);

        const adsValues = { installerId: inst.id, ...parsed, fetchedAt: new Date().toISOString() };
        await db.insert(googleAdsData).values(adsValues)
          .onConflictDoUpdate({ target: googleAdsData.installerId, set: adsValues });
      })
    );

    for (const r of results) {
      processed++;
      if (r.status === "rejected") {
        errors++;
        errorLog.push(r.reason?.message || String(r.reason));
      }
    }

    await db.update(enrichmentJobs).set({ processedItems: processed, errorCount: errors }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: processed, errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
}
