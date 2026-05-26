import { db } from "@/lib/db";
import {
  installers,
  googleAdsData,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
  transparencyUrls: string | null;
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
  const transparencyUrls: string[] = [];
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
    if (item.url) transparencyUrls.push(item.url as string);
  }

  return {
    totalAds: items.length,
    textAds, imageAds, videoAds,
    platforms: platforms.size > 0 ? JSON.stringify(Array.from(platforms)) : null,
    firstAdSeen: firstSeen,
    lastAdSeen: lastSeen,
    sampleAdTitles: sampleTitles.length > 0 ? JSON.stringify(sampleTitles) : null,
    transparencyUrls: transparencyUrls.length > 0 ? JSON.stringify(transparencyUrls) : null,
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

// Batch enrichment (enrichGoogleAdsBatch) removed — now handled by Supabase Edge Function
// Only fetchGoogleAdsTransparency() is kept for individual installer enrichment
