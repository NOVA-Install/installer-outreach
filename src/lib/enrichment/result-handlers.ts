/**
 * Source-specific result handlers for collectPendingResults.
 *
 * Each handler processes a single DataForSEO task result and saves
 * the extracted data to the appropriate table. Handlers are dispatched
 * by task.source in the main collection loop.
 */

import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  googleBusinessInfo,
  jobPostings,
  dataforseoTasks,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { aiMatchTrustpilot, aiMatchGoogleReview } from "./ai-matcher";

// ─── Shared types ───

export interface TaskRef {
  id: number;
  installerId: number;
}

export interface TaskHandlerResult {
  outcome: "collected" | "rejected" | "ai_failed";
  rejectedMatch?: string;
}

// ─── Helpers ───

/** Calculate reviews per month from actual review date data. Returns null if no dates available. */
function calculateReviewsPerMonth(reviewsData: unknown): number | null {
  if (!Array.isArray(reviewsData) || reviewsData.length === 0) return null;

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let recentCount = 0;
  let hasAnyDates = false;

  for (const review of reviewsData) {
    const r = review as Record<string, unknown>;
    const timestamp = r.review_timestamp || r.datetime || r.date;
    if (!timestamp || typeof timestamp !== "string") continue;

    hasAnyDates = true;
    const date = new Date(timestamp);
    if (!isNaN(date.getTime()) && date.getTime() >= thirtyDaysAgo) {
      recentCount++;
    }
  }

  return hasAnyDates ? recentCount : null;
}

/** Extract root domain handling two-part TLDs like .co.uk */
const TWO_PART_TLDS = [
  "co.uk", "org.uk", "net.uk", "ac.uk", "gov.uk",
  "com.au", "org.au", "net.au", "co.nz", "com.br",
  "co.za", "co.in",
];

export function extractRootDomain(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".");
  const last2 = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.includes(last2) && parts.length > 2) {
    return parts.slice(-3).join(".");
  }
  if (parts.length > 2) {
    return parts.slice(-2).join(".");
  }
  return parts.join(".");
}

/** Normalize a company name for quick comparison */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|inc|t\/a|trading as)\b/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9&\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const NON_UK_TLDS = [
  ".dk", ".de", ".fr", ".nl", ".se", ".no", ".fi", ".es", ".it",
  ".pl", ".pt", ".at", ".ch", ".be", ".au", ".nz", ".ca", ".us",
  ".in", ".za", ".br", ".mx", ".jp", ".kr", ".cn",
];

const JOB_DOMAINS = [
  "indeed.co.uk", "indeed.com", "linkedin.com", "reed.co.uk",
  "totaljobs.com", "glassdoor.co.uk", "glassdoor.com",
  "cv-library.co.uk", "monster.co.uk", "adzuna.co.uk", "jora.com",
];

// ─── 1. Google Reviews ───

export async function handleGoogleReviewResult(
  task: TaskRef,
  result: Record<string, unknown>,
  rawResult: string | null
): Promise<TaskHandlerResult> {
  const ratingObj = result.rating;
  const ratingVal = typeof ratingObj === "object"
    ? (ratingObj as Record<string, unknown>)?.value as number | undefined
    : ratingObj as number | undefined;
  const reviewsCount = (result.reviews_count || 0) as number;
  const businessTitle = (result.title || result.name || "") as string;
  const businessAddress = (result.address || "") as string;
  const businessCategory = (result.category || result.type || "") as string;
  const reviewsPerMonth = calculateReviewsPerMonth(result.reviews_data);

  if (!ratingVal) {
    await db.update(dataforseoTasks).set({
      status: "completed",
      resultSummary: "No rating found in result",
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));
    return { outcome: "collected" };
  }

  const [inst] = await db
    .select({
      companyName: installers.companyName,
      website: installers.website,
      postcode: installers.postcode,
      county: installers.county,
    })
    .from(installers)
    .where(eq(installers.id, task.installerId))
    .limit(1);

  if (!inst) {
    await db.update(dataforseoTasks).set({
      status: "failed",
      resultSummary: "Installer not found",
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));
    throw new Error("Installer not found for google_reviews task");
  }

  // ── Name similarity pre-check ──
  const instName = normalize(inst.companyName);
  const bizName = normalize(businessTitle);
  const isExactMatch = instName === bizName;
  const isCloseMatch = instName.includes(bizName) || bizName.includes(instName);
  const wordsInst = instName.split(" ").filter((w) => w.length > 1);
  const wordsBiz = bizName.split(" ").filter((w) => w.length > 1);
  const commonWords = wordsInst.filter((w) => wordsBiz.includes(w));
  const wordOverlap = wordsInst.length > 0 ? commonWords.length / wordsInst.length : 0;
  const isHighOverlap = wordOverlap >= 0.6;

  let matchMethod = "";
  let shouldAccept = false;

  if (isExactMatch) {
    shouldAccept = true;
    matchMethod = "exact name match";
  } else if (isCloseMatch) {
    shouldAccept = true;
    matchMethod = `close name match (${Math.round(wordOverlap * 100)}%)`;
  } else if (isHighOverlap) {
    shouldAccept = true;
    matchMethod = `word overlap ${Math.round(wordOverlap * 100)}%`;
  }

  // ── Auto-accept: strong name match ──
  if (shouldAccept) {
    const grValues = {
      installerId: task.installerId,
      placeId: (result.place_id || null) as string | null,
      rating: ratingVal,
      reviewCount: reviewsCount,
      reviewsPerMonth,
      businessStatus: null,
      fetchedAt: new Date().toISOString(),
    };
    await db.insert(googleReviews).values(grValues)
      .onConflictDoUpdate({ target: googleReviews.installerId, set: grValues });

    await db.update(dataforseoTasks).set({
      status: "completed",
      resultSummary: `Auto-matched (${matchMethod}): "${businessTitle}", rating: ${ratingVal}, ${reviewsCount} reviews`,
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));

    return { outcome: "collected" };
  }

  // ── AI matching: ambiguous name ──
  try {
    const aiResult = await aiMatchGoogleReview(
      { companyName: inst.companyName, website: inst.website, postcode: inst.postcode, county: inst.county },
      [{
        index: 0,
        title: businessTitle,
        address: businessAddress,
        placeId: (result.place_id || null) as string | null,
        rating: ratingVal,
        reviewCount: reviewsCount,
        category: businessCategory,
      }]
    );

    if (aiResult.matched) {
      const grAiValues = {
        installerId: task.installerId,
        placeId: (result.place_id || null) as string | null,
        rating: ratingVal,
        reviewCount: reviewsCount,
        reviewsPerMonth,
        businessStatus: null,
        fetchedAt: new Date().toISOString(),
      };
      await db.insert(googleReviews).values(grAiValues)
        .onConflictDoUpdate({ target: googleReviews.installerId, set: grAiValues });

      await db.update(dataforseoTasks).set({
        status: "completed",
        resultSummary: `AI verified (${aiResult.confidence}): "${businessTitle}", rating: ${ratingVal}, ${reviewsCount} reviews. ${aiResult.reasoning}`,
        rawResult,
        completedAt: new Date().toISOString(),
      }).where(eq(dataforseoTasks.id, task.id));

      return { outcome: "collected" };
    }

    // AI explicitly rejected
    await db.update(dataforseoTasks).set({
      status: "no_results",
      resultSummary: `AI rejected: "${businessTitle}" (${businessAddress}). ${aiResult.reasoning}`,
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));

    return {
      outcome: "rejected",
      rejectedMatch: `${inst.companyName} → Google returned "${businessTitle}": ${aiResult.reasoning}`,
    };
  } catch (aiErr) {
    // AI unavailable — preserve raw result for retry, don't save unverified data
    await db.update(dataforseoTasks).set({
      status: "ai_failed",
      resultSummary: `AI unavailable — unverified: "${businessTitle}", rating: ${ratingVal}. ${aiErr instanceof Error ? aiErr.message : ""}`,
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));

    return { outcome: "ai_failed" };
  }
}

// ─── 2. Trustpilot ───

export async function handleTrustpilotResult(
  task: TaskRef,
  result: Record<string, unknown>,
  rawResult: string | null
): Promise<TaskHandlerResult> {
  const allItems = (result.items || []) as Record<string, unknown>[];

  // Filter out non-UK domains
  const items = allItems.filter((item) => {
    if (!item.domain) return false;
    return !NON_UK_TLDS.some((tld) => (item.domain as string).endsWith(tld));
  });

  const [inst] = await db
    .select({
      companyName: installers.companyName,
      website: installers.website,
      postcode: installers.postcode,
      county: installers.county,
    })
    .from(installers)
    .where(eq(installers.id, task.installerId))
    .limit(1);

  if (!inst) {
    await db.update(dataforseoTasks).set({
      status: "failed",
      resultSummary: "Installer not found",
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));
    throw new Error("Installer not found for trustpilot task");
  }

  const candidates = items.map((item, idx) => ({
    index: idx,
    name: (item.name || item.display_name || item.domain || "") as string,
    domain: (item.domain || null) as string | null,
    rating: ((item.rating as Record<string, unknown>)?.value ?? null) as number | null,
    reviewCount: (item.reviews_count || null) as number | null,
    location: (
      (item.location as Record<string, Record<string, string>> | undefined)?.address_info?.city ||
      (item.location as Record<string, Record<string, string>> | undefined)?.address_info?.country ||
      null
    ) as string | null,
    categories: Array.isArray(item.categories)
      ? (item.categories as { title?: string }[]).map((c) => c.title).join(", ")
      : null,
  }));

  try {
    const aiResult = await aiMatchTrustpilot(
      { companyName: inst.companyName, website: inst.website, postcode: inst.postcode, county: inst.county },
      candidates
    );

    if (aiResult.matched && aiResult.matchIndex != null) {
      const match = items[aiResult.matchIndex];
      const matchRating = (match.rating as Record<string, unknown>)?.value;

      const tpValues = {
        installerId: task.installerId,
        trustpilotUrl: match.domain
          ? `https://www.trustpilot.com/review/${extractRootDomain(match.domain as string)}`
          : null,
        rating: (matchRating || null) as number | null,
        reviewCount: (match.reviews_count || 0) as number,
        trustScore: (match.trust_score || null) as number | null,
        fetchedAt: new Date().toISOString(),
      };
      await db.insert(trustpilotReviews).values(tpValues)
        .onConflictDoUpdate({ target: trustpilotReviews.installerId, set: tpValues });

      await db.update(dataforseoTasks).set({
        status: "completed",
        resultSummary: `AI matched (${aiResult.confidence}): ${match.domain || candidates[aiResult.matchIndex].name}, rating: ${matchRating}. ${aiResult.reasoning}`,
        rawResult,
        completedAt: new Date().toISOString(),
      }).where(eq(dataforseoTasks.id, task.id));

      return { outcome: "collected" };
    }

    // AI rejected all candidates
    const topName = candidates[0]?.name || "none";
    await db.update(dataforseoTasks).set({
      status: "no_results",
      resultSummary: `AI rejected all ${candidates.length} candidates (${aiResult.confidence}). Top: "${topName}". ${aiResult.reasoning}`,
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));

    return {
      outcome: "rejected",
      rejectedMatch: `${inst.companyName} → AI rejected "${topName}": ${aiResult.reasoning}`,
    };
  } catch (aiErr) {
    const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
    await db.update(dataforseoTasks).set({
      status: "failed",
      resultSummary: `AI matching error: ${errMsg}`,
      rawResult,
      completedAt: new Date().toISOString(),
    }).where(eq(dataforseoTasks.id, task.id));
    throw new Error(`Trustpilot AI error: ${errMsg}`);
  }
}

// ─── 3. Google Business Info ───

export async function handleGoogleBusinessResult(
  task: TaskRef,
  result: Record<string, unknown>,
  rawResult: string | null
): Promise<TaskHandlerResult> {
  const addressInfo = result.address_info as Record<string, unknown> | undefined;

  const bizData = {
    placeId: (result.place_id || null) as string | null,
    title: (result.title || null) as string | null,
    phone: (result.phone || null) as string | null,
    website: (result.domain || null) as string | null,
    mainCategory: (result.category || null) as string | null,
    address: (result.address || null) as string | null,
    city: (addressInfo?.city || null) as string | null,
    postalCode: (addressInfo?.zip || null) as string | null,
    latitude: (result.latitude || null) as number | null,
    longitude: (result.longitude || null) as number | null,
    totalPhotos: (result.total_photos || null) as number | null,
    isClaimed: (result.is_claimed ?? null) as boolean | null,
    currentStatus: (result.current_status || null) as string | null,
    workHours: result.work_hours ? JSON.stringify(result.work_hours) : null,
    priceLevel: (result.price_level || null) as string | null,
    additionalCategories: result.additional_categories
      ? JSON.stringify(result.additional_categories)
      : null,
    fetchedAt: new Date().toISOString(),
  };

  const bizInsertValues = { installerId: task.installerId, ...bizData };
  await db.insert(googleBusinessInfo).values(bizInsertValues)
    .onConflictDoUpdate({ target: googleBusinessInfo.installerId, set: bizData });

  await db.update(dataforseoTasks).set({
    status: "completed",
    resultSummary: `${result.title} | ${result.phone || "no phone"} | ${result.domain || "no website"}`,
    rawResult,
    completedAt: new Date().toISOString(),
  }).where(eq(dataforseoTasks.id, task.id));

  return { outcome: "collected" };
}

// ─── 4. Job Postings ───

export async function handleJobPostingsResult(
  task: TaskRef,
  result: Record<string, unknown>,
  rawResult: string | null
): Promise<TaskHandlerResult> {
  const items = (result.items || []) as Record<string, unknown>[];

  const postingsFound = items
    .filter((item) =>
      item.type === "organic" &&
      item.domain &&
      JOB_DOMAINS.some((jd) => (item.domain as string).includes(jd))
    )
    .map((item) => ({
      title: (item.title || "") as string,
      source: (item.domain || "") as string,
      url: (item.url || "") as string,
      snippet: ((item.description as string | undefined)?.substring(0, 200) || ""),
    }))
    .slice(0, 20);

  const isHiring = postingsFound.length > 0;

  const jobData = {
    totalPostings: postingsFound.length,
    postings: postingsFound.length > 0 ? JSON.stringify(postingsFound) : null,
    isHiring,
    fetchedAt: new Date().toISOString(),
  };
  const jobInsertValues = { installerId: task.installerId, ...jobData };
  await db.insert(jobPostings).values(jobInsertValues)
    .onConflictDoUpdate({ target: jobPostings.installerId, set: jobData });

  await db.update(dataforseoTasks).set({
    status: "completed",
    resultSummary: isHiring ? `Hiring: ${postingsFound.length} postings found` : "Not hiring",
    rawResult,
    completedAt: new Date().toISOString(),
  }).where(eq(dataforseoTasks.id, task.id));

  return { outcome: "collected" };
}
