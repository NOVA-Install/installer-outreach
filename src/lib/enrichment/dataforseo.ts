import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  seoData,
  enrichmentJobs,
  dataforseoTasks,
  googleBusinessInfo,
  jobPostings,
} from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { RateLimiter } from "./rate-limiter";
import { aiMatchTrustpilot, aiMatchGoogleReview } from "./ai-matcher";

const BASE_URL = "https://api.dataforseo.com/v3";

// Extract root domain, handling .co.uk, .com.au etc.
function extractRootDomain(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".");
  // Two-part TLDs: co.uk, com.au, org.uk, etc.
  const twoPartTlds = ["co.uk", "com.au", "org.uk", "net.au", "co.nz", "com.br", "co.za", "co.in"];
  const last2 = parts.slice(-2).join(".");
  if (twoPartTlds.includes(last2) && parts.length > 2) {
    return parts.slice(-3).join(".");
  }
  if (parts.length > 2) {
    return parts.slice(-2).join(".");
  }
  return parts.join(".");
}

function getAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function apiPost(endpoint: string, body: unknown[]) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { Authorization: getAuth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.status_code !== 20000) {
    throw new Error(`API error ${data.status_code}: ${data.status_message}`);
  }
  return data;
}

// ─── PHASE 1: Submit tasks in bulk (fast, no waiting) ───

// Google Reviews - submit up to 100 tasks per batch
export async function enrichGoogleReviews(jobId: number, installerIds?: number[], priority: 1 | 2 = 1) {
  // Get installers without reviews AND without existing pending/completed tasks
  const existingTaskIds = db
    .select({ installerId: dataforseoTasks.installerId })
    .from(dataforseoTasks)
    .where(sql`${dataforseoTasks.source} = 'google_reviews' AND ${dataforseoTasks.status} IN ('pending', 'completed')`);

  const query = installerIds
    ? db.select({ id: installers.id, companyName: installers.companyName, postcode: installers.postcode })
        .from(installers)
        .where(sql`${installers.id} IN (${sql.join(installerIds.map(id => sql`${id}`), sql`,`)}) AND ${installers.id} NOT IN (${existingTaskIds})`)
    : db.select({ id: installers.id, companyName: installers.companyName, postcode: installers.postcode })
        .from(installers)
        .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
        .where(sql`${googleReviews.id} IS NULL AND ${installers.id} NOT IN (${existingTaskIds})`);

  const toEnrich = await query;

  await db.update(enrichmentJobs).set({
    totalItems: toEnrich.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let submitted = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Batch submit in groups of 100
  for (let i = 0; i < toEnrich.length; i += 100) {
    const batch = toEnrich.slice(i, i + 100);

    const tasks = batch.map((inst) => ({
      keyword: `${inst.companyName} solar installer ${inst.postcode || ""}`.trim(),
      location_name: "United Kingdom",
      language_name: "English",
      depth: 10,
      priority,
      tag: String(inst.id),
    }));

    try {
      const result = await apiPost("/business_data/google/reviews/task_post", tasks);

      // Save each task ID to DB for later retrieval
      for (const task of result.tasks || []) {
        if (task.status_code === 20100) {
          const instId = parseInt(task.data?.tag || "0", 10);
          await db.insert(dataforseoTasks).values({
            installerId: instId,
            taskId: task.id,
            source: "google_reviews",
            endpoint: "business_data/google/reviews",
            status: "pending",
            searchTerm: task.data?.keyword || null,
          });
          submitted++;
        } else {
          errors++;
          errorLog.push(`Task failed: ${task.status_message}`);
        }
      }
    } catch (err) {
      errors += batch.length;
      errorLog.push(`Batch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await db.update(enrichmentJobs).set({ processedItems: submitted, errorCount: errors }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: submitted, errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}

// Helper: extract a human-readable name from a domain
// e.g. "macbrookgas" → "macbrook gas", "247staywarm" → "247 stay warm"
function domainToName(domain: string): string | null {
  // Remove TLD
  const name = domain.replace(/^www\./, "").split(".")[0];
  if (!name || name.length < 3) return null;

  // Insert spaces before uppercase letters, between letters and numbers
  let spaced = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")        // camelCase
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")         // letters→numbers
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")         // numbers→letters
    .toLowerCase();

  // Common word boundaries for UK businesses
  const commonWords = ["solar", "energy", "power", "electric", "electrical", "heating", "plumbing", "green", "eco", "home", "homes", "gas", "heat", "warm", "renewables", "renewable", "install", "installations", "services", "solutions", "systems", "group", "ltd", "uk", "north", "south", "east", "west"];

  // Try to split on known words
  for (const word of commonWords) {
    const idx = spaced.indexOf(word);
    if (idx > 0 && spaced[idx - 1] !== " ") {
      spaced = spaced.slice(0, idx) + " " + spaced.slice(idx);
    }
    const endIdx = idx + word.length;
    if (idx >= 0 && endIdx < spaced.length && spaced[endIdx] !== " ") {
      spaced = spaced.slice(0, endIdx) + " " + spaced.slice(endIdx);
    }
  }

  // Clean up multiple spaces
  spaced = spaced.replace(/\s+/g, " ").trim();

  // Don't return if it's the same as the raw domain name (no splits found)
  if (spaced === name.toLowerCase()) return null;

  return spaced;
}

// Trustpilot - Phase 1: submit company name searches only
// After collecting results, call enrichTrustpilotDomainFallback for unmatched
export async function enrichTrustpilot(jobId: number, installerIds?: number[], priority: 1 | 2 = 1) {
  const existingTpTasks = db
    .select({ installerId: dataforseoTasks.installerId })
    .from(dataforseoTasks)
    .where(sql`${dataforseoTasks.source} = 'trustpilot_search' AND ${dataforseoTasks.status} IN ('pending', 'completed')`);

  const query = installerIds
    ? db.select({ id: installers.id, companyName: installers.companyName, website: installers.website })
        .from(installers)
        .where(sql`${installers.id} IN (${sql.join(installerIds.map(id => sql`${id}`), sql`,`)}) AND ${installers.id} NOT IN (${existingTpTasks})`)
    : db.select({ id: installers.id, companyName: installers.companyName, website: installers.website })
        .from(installers)
        .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
        .where(sql`${trustpilotReviews.id} IS NULL AND ${installers.id} NOT IN (${existingTpTasks})`);

  const toEnrich = await query;

  await db.update(enrichmentJobs).set({
    totalItems: toEnrich.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let submitted = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Phase 1: Submit company name searches only
  const tasks = toEnrich.map((inst) => ({
    keyword: inst.companyName,
    depth: 10,
    priority,
    tag: `${inst.id}:name`,
  }));

  // Batch submit in groups of 100
  for (let i = 0; i < tasks.length; i += 100) {
    const batch = tasks.slice(i, i + 100);

    try {
      const result = await apiPost("/business_data/trustpilot/search/task_post", batch);

      for (const task of result.tasks || []) {
        if (task.status_code === 20100) {
          const tagParts = (task.data?.tag || "0").split(":");
          const instId = parseInt(tagParts[0], 10);
          const searchType = tagParts[1] || "name";
          await db.insert(dataforseoTasks).values({
            installerId: instId,
            taskId: task.id,
            source: "trustpilot_search",
            endpoint: "business_data/trustpilot/search",
            status: "pending",
            searchTerm: `[${searchType}] ${task.data?.keyword || ""}`,
          });
          submitted++;
        } else {
          errors++;
          errorLog.push(`Task failed: ${task.status_message}`);
        }
      }
    } catch (err) {
      errors += batch.length;
      errorLog.push(`Batch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await db.update(enrichmentJobs).set({ processedItems: submitted, errorCount: errors }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: submitted, errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}

// Trustpilot - Phase 2: domain fallback for unmatched installers
// Call this after collecting results from Phase 1
export async function enrichTrustpilotDomainFallback(jobId: number, priority: 1 | 2 = 1) {
  // Find installers that still don't have trustpilot data and have a website
  const unmatched = await db
    .select({ id: installers.id, companyName: installers.companyName, website: installers.website })
    .from(installers)
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
    .where(sql`${trustpilotReviews.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`);

  await db.update(enrichmentJobs).set({
    totalItems: unmatched.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let submitted = 0;
  let errors = 0;
  const errorLog: string[] = [];

  const tasks: { keyword: string; depth: number; priority: number; tag: string }[] = [];

  for (const inst of unmatched) {
    if (!inst.website) continue;
    try {
      const hostname = inst.website.startsWith("http")
        ? new URL(inst.website).hostname
        : inst.website;
      const rawDomain = hostname.replace(/^www\./, "").split(".")[0];

      if (rawDomain && rawDomain.length >= 3) {
        // Raw domain name
        tasks.push({ keyword: rawDomain, depth: 10, priority, tag: `${inst.id}:domain` });

        // Domain with spaces inserted
        const spacedName = domainToName(hostname);
        if (spacedName && spacedName !== rawDomain) {
          tasks.push({ keyword: spacedName, depth: 10, priority, tag: `${inst.id}:domain_spaced` });
        }
      }
    } catch {
      // Skip invalid URLs
    }
  }

  for (let i = 0; i < tasks.length; i += 100) {
    const batch = tasks.slice(i, i + 100);

    try {
      const result = await apiPost("/business_data/trustpilot/search/task_post", batch);

      for (const task of result.tasks || []) {
        if (task.status_code === 20100) {
          const tagParts = (task.data?.tag || "0").split(":");
          const instId = parseInt(tagParts[0], 10);
          const searchType = tagParts[1] || "domain";
          await db.insert(dataforseoTasks).values({
            installerId: instId,
            taskId: task.id,
            source: "trustpilot_search",
            endpoint: "business_data/trustpilot/search",
            status: "pending",
            searchTerm: `[${searchType}] ${task.data?.keyword || ""}`,
          });
          submitted++;
        } else {
          errors++;
        }
      }
    } catch (err) {
      errors += batch.length;
      errorLog.push(`Batch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await db.update(enrichmentJobs).set({ processedItems: submitted, errorCount: errors }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: submitted, errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}

// Backlinks / SEO data (live endpoint - parallel batches of 10)
export async function enrichSeoData(jobId: number, installerIds?: number[]) {
  const query = installerIds
    ? db.select({ id: installers.id, website: installers.website })
        .from(installers)
        .where(sql`${installers.id} IN (${sql.join(installerIds.map(id => sql`${id}`), sql`,`)}) AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`)
    : db.select({ id: installers.id, website: installers.website })
        .from(installers)
        .leftJoin(seoData, eq(installers.id, seoData.installerId))
        .where(sql`${seoData.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`);

  const toEnrich = await query;

  await db.update(enrichmentJobs).set({
    totalItems: toEnrich.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let processed = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Process in parallel batches of 10
  for (let i = 0; i < toEnrich.length; i += 10) {
    // Check for cancellation
    const [currentJob] = await db.select({ status: enrichmentJobs.status }).from(enrichmentJobs).where(eq(enrichmentJobs.id, jobId)).limit(1);
    if (currentJob?.status === "cancelled") break;

    const batch = toEnrich.slice(i, i + 10).filter((inst) => inst.website);

    const results = await Promise.allSettled(
      batch.map(async (installer) => {
        const domain = installer.website!.startsWith("http")
          ? new URL(installer.website!).hostname
          : installer.website!.replace(/^www\./, "");

        const result = await apiPost("/backlinks/summary/live", [{ target: domain }]);
        const task = result?.tasks?.[0];
        if (task?.status_code !== 20000 && task?.status_code !== 40102) {
          throw new Error(`${task?.status_code}: ${task?.status_message}`);
        }

        const data = task?.result?.[0];
        if (data && data.rank != null) {
          const existing = await db.select({ id: seoData.id }).from(seoData).where(eq(seoData.installerId, installer.id)).limit(1);
          if (existing.length === 0) {
            await db.insert(seoData).values({
              installerId: installer.id,
              domainAuthority: data.rank || null,
              backlinksCount: data.backlinks || 0,
              referringDomains: data.referring_domains || 0,
              organicKeywords: null,
              fetchedAt: new Date().toISOString(),
            });
          }
        }
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
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}

// ─── PHASE 2: Collect results for pending tasks ───

export async function collectPendingResults() {
  const auth = getAuth();
  const startTime = Date.now();
  const MAX_DURATION_MS = 25000; // Stop after 25 seconds to avoid API route timeout

  const pendingTasks = await db
    .select()
    .from(dataforseoTasks)
    .where(eq(dataforseoTasks.status, "pending"))
    .limit(2000);

  let collected = 0;
  let stillPending = 0;
  let errored = 0;
  let rejected = 0;
  const rejectedMatches: string[] = [];

  // Process in parallel batches of 130 (API limit: 2000 calls/min)
  let timedOut = false;
  for (let batchStart = 0; batchStart < pendingTasks.length; batchStart += 130) {
    if (Date.now() - startTime > MAX_DURATION_MS) { timedOut = true; break; }
    const batch = pendingTasks.slice(batchStart, batchStart + 130);

    await Promise.allSettled(batch.map(async (task) => {
    try {
      const res = await fetch(`${BASE_URL}/${task.endpoint}/task_get/${task.taskId}`, {
        headers: { Authorization: auth },
      });
      const data = await res.json();
      const dfsTask = data?.tasks?.[0];
      const rawResult = dfsTask?.result?.[0] ? JSON.stringify(dfsTask.result[0]) : null;

      // Still in queue
      if (dfsTask?.status_code === 40601 || dfsTask?.status_code === 40602) {
        stillPending++;
        return;
      }

      // No results
      if (dfsTask?.status_code === 40102) {
        await db.update(dataforseoTasks).set({
          status: "no_results",
          resultSummary: "No results found",
          rawResult,
          completedAt: new Date().toISOString(),
        }).where(eq(dataforseoTasks.id, task.id));
        collected++;
        return;
      }

      // Error
      if (dfsTask?.status_code && dfsTask.status_code >= 40000) {
        await db.update(dataforseoTasks).set({
          status: "failed",
          resultSummary: `${dfsTask.status_code}: ${dfsTask.status_message}`,
          rawResult,
          completedAt: new Date().toISOString(),
        }).where(eq(dataforseoTasks.id, task.id));
        errored++;
        return;
      }

      // Success - process based on source
      const result = dfsTask?.result?.[0];

      if (task.source === "google_reviews" && result) {
        // Get installer data for AI verification
        const [inst] = await db
          .select({ companyName: installers.companyName, website: installers.website, postcode: installers.postcode, county: installers.county })
          .from(installers)
          .where(eq(installers.id, task.installerId))
          .limit(1);

        // Build candidate from the result (Google Reviews API returns a single business)
        const ratingObj = result.rating;
        const ratingVal = typeof ratingObj === "object" ? ratingObj?.value : ratingObj;
        const reviewsCount = result.reviews_count || 0;
        const businessTitle = result.title || result.name || "";
        const businessAddress = result.address || "";
        const businessCategory = result.category || result.type || "";

        if (ratingVal && inst) {
          // Use AI to verify this Google Business result is the correct installer
          try {
            const aiResult = await aiMatchGoogleReview(
              { companyName: inst.companyName, website: inst.website, postcode: inst.postcode, county: inst.county },
              [{
                index: 0,
                title: businessTitle,
                address: businessAddress,
                placeId: result.place_id || null,
                rating: ratingVal,
                reviewCount: reviewsCount,
                category: businessCategory,
              }]
            );

            if (aiResult.matched) {
              // AI confirmed — save the review data
              const existing = await db.select({ id: googleReviews.id }).from(googleReviews)
                .where(eq(googleReviews.installerId, task.installerId)).limit(1);
              if (existing.length === 0) {
                await db.insert(googleReviews).values({
                  installerId: task.installerId,
                  placeId: result.place_id || null,
                  rating: ratingVal,
                  reviewCount: reviewsCount,
                  reviewsPerMonth: reviewsCount > 0 ? reviewsCount / 36 : null,
                  businessStatus: null,
                  fetchedAt: new Date().toISOString(),
                });
              }

              await db.update(dataforseoTasks).set({
                status: "completed",
                resultSummary: `AI verified (${aiResult.confidence}): "${businessTitle}", rating: ${ratingVal}, ${reviewsCount} reviews. ${aiResult.reasoning}`,
                rawResult, completedAt: new Date().toISOString(),
              }).where(eq(dataforseoTasks.id, task.id));
            } else {
              // AI rejected — don't save wrong data
              await db.update(dataforseoTasks).set({
                status: "no_results",
                resultSummary: `AI rejected: "${businessTitle}" (${businessAddress}). ${aiResult.reasoning}`,
                rawResult, completedAt: new Date().toISOString(),
              }).where(eq(dataforseoTasks.id, task.id));

              rejected++;
              rejectedMatches.push(`${inst.companyName} → Google returned "${businessTitle}": ${aiResult.reasoning}`);
            }
          } catch (aiErr) {
            // AI failed — fall back to saving with a warning
            const existing = await db.select({ id: googleReviews.id }).from(googleReviews)
              .where(eq(googleReviews.installerId, task.installerId)).limit(1);
            if (existing.length === 0) {
              await db.insert(googleReviews).values({
                installerId: task.installerId,
                placeId: result.place_id || null,
                rating: ratingVal,
                reviewCount: reviewsCount,
                reviewsPerMonth: reviewsCount > 0 ? reviewsCount / 36 : null,
                businessStatus: null,
                fetchedAt: new Date().toISOString(),
              });
            }
            await db.update(dataforseoTasks).set({
              status: "completed",
              resultSummary: `Saved (AI unavailable): "${businessTitle}", rating: ${ratingVal}. ${aiErr instanceof Error ? aiErr.message : ""}`,
              rawResult, completedAt: new Date().toISOString(),
            }).where(eq(dataforseoTasks.id, task.id));
          }
        } else {
          await db.update(dataforseoTasks).set({
            status: "completed",
            resultSummary: "No rating found in result",
            rawResult, completedAt: new Date().toISOString(),
          }).where(eq(dataforseoTasks.id, task.id));
        }
      }

      if (task.source === "trustpilot_search" && result) {
        const allItems = result.items || [];

        // Filter out non-UK domains
        const nonUkTlds = [".dk", ".de", ".fr", ".nl", ".se", ".no", ".fi", ".es", ".it", ".pl", ".pt", ".at", ".ch", ".be", ".au", ".nz", ".ca", ".us", ".in", ".za", ".br", ".mx", ".jp", ".kr", ".cn"];
        const items = allItems.filter((item: { domain?: string }) => {
          if (!item.domain) return false;
          if (nonUkTlds.some((tld) => item.domain!.endsWith(tld))) return false;
          return true;
        });

        // Get installer data for AI matching
        const [inst] = await db
          .select({ companyName: installers.companyName, website: installers.website, postcode: installers.postcode, county: installers.county })
          .from(installers)
          .where(eq(installers.id, task.installerId))
          .limit(1);

        if (!inst) {
          await db.update(dataforseoTasks).set({
            status: "failed", resultSummary: "Installer not found", rawResult, completedAt: new Date().toISOString(),
          }).where(eq(dataforseoTasks.id, task.id));
          errored++;
          return;
        }

        // Use AI to match the correct Trustpilot profile
        const candidates = items.map((item: Record<string, unknown>, idx: number) => ({
          index: idx,
          name: (item.name || item.display_name || item.domain || "") as string,
          domain: (item.domain || null) as string | null,
          rating: (item.rating as { value?: number })?.value ?? null,
          reviewCount: (item.reviews_count || null) as number | null,
          location: ((item.location as Record<string, Record<string, string>> | undefined)?.address_info?.city || (item.location as Record<string, Record<string, string>> | undefined)?.address_info?.country || null) as string | null,
          categories: Array.isArray(item.categories) ? (item.categories as { title?: string }[]).map((c) => c.title).join(", ") : null,
        }));

        try {
          const aiResult = await aiMatchTrustpilot(
            { companyName: inst.companyName, website: inst.website, postcode: inst.postcode, county: inst.county },
            candidates
          );

          if (aiResult.matched && aiResult.matchIndex != null) {
            const match = items[aiResult.matchIndex];

            // Don't overwrite existing
            const existing = await db.select({ id: trustpilotReviews.id }).from(trustpilotReviews)
              .where(eq(trustpilotReviews.installerId, task.installerId)).limit(1);
            if (existing.length === 0) {
              await db.insert(trustpilotReviews).values({
                installerId: task.installerId,
                trustpilotUrl: match.domain ? `https://www.trustpilot.com/review/${extractRootDomain(match.domain)}` : null,
                rating: match.rating?.value || null,
                reviewCount: match.reviews_count || 0,
                trustScore: match.trust_score || null,
                fetchedAt: new Date().toISOString(),
              });
            }

            await db.update(dataforseoTasks).set({
              status: "completed",
              resultSummary: `AI matched (${aiResult.confidence}): ${match.domain || candidates[aiResult.matchIndex].name}, rating: ${match.rating?.value}. ${aiResult.reasoning}`,
              rawResult, completedAt: new Date().toISOString(),
            }).where(eq(dataforseoTasks.id, task.id));
          } else {
            // AI rejected all candidates
            const topName = candidates[0]?.name || "none";
            await db.update(dataforseoTasks).set({
              status: "no_results",
              resultSummary: `AI rejected all ${candidates.length} candidates (${aiResult.confidence}). Top: "${topName}". ${aiResult.reasoning}`,
              rawResult, completedAt: new Date().toISOString(),
            }).where(eq(dataforseoTasks.id, task.id));

            rejected++;
            rejectedMatches.push(`${inst.companyName} → AI rejected "${topName}": ${aiResult.reasoning}`);
          }
        } catch (aiErr) {
          // AI matching failed - log but don't block
          const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
          await db.update(dataforseoTasks).set({
            status: "failed",
            resultSummary: `AI matching error: ${errMsg}`,
            rawResult, completedAt: new Date().toISOString(),
          }).where(eq(dataforseoTasks.id, task.id));
          errored++;
        }
      }

      // Google Business Info
      if (task.source === "google_business_info" && result) {
        const bizData = {
          placeId: result.place_id || null,
          title: result.title || null,
          phone: result.phone || null,
          website: result.domain || null,
          mainCategory: result.category || null,
          address: result.address || null,
          city: result.address_info?.city || null,
          postalCode: result.address_info?.zip || null,
          latitude: result.latitude || null,
          longitude: result.longitude || null,
          totalPhotos: result.total_photos || null,
          isClaimed: result.is_claimed ?? null,
          currentStatus: result.current_status || null,
          workHours: result.work_hours ? JSON.stringify(result.work_hours) : null,
          priceLevel: result.price_level || null,
          additionalCategories: result.additional_categories ? JSON.stringify(result.additional_categories) : null,
          fetchedAt: new Date().toISOString(),
        };
        const existingBiz = await db.select({ id: googleBusinessInfo.id }).from(googleBusinessInfo).where(eq(googleBusinessInfo.installerId, task.installerId)).limit(1);
        if (existingBiz.length > 0) {
          await db.update(googleBusinessInfo).set(bizData).where(eq(googleBusinessInfo.installerId, task.installerId));
        } else {
          await db.insert(googleBusinessInfo).values({ installerId: task.installerId, ...bizData });
        }

        await db.update(dataforseoTasks).set({
          status: "completed",
          resultSummary: `${result.title} | ${result.phone || "no phone"} | ${result.domain || "no website"}`,
          rawResult, completedAt: new Date().toISOString(),
        }).where(eq(dataforseoTasks.id, task.id));
      }

      // Job Postings (from SERP organic results)
      if (task.source === "job_postings" && result) {
        const jobDomains = ["indeed.co.uk", "indeed.com", "linkedin.com", "reed.co.uk", "totaljobs.com", "glassdoor.co.uk", "glassdoor.com", "cv-library.co.uk", "adzuna.co.uk"];
        const items = result.items || [];

        const postingsFound = items
          .filter((item: { type?: string; domain?: string }) =>
            item.type === "organic" && item.domain && jobDomains.some((jd: string) => item.domain!.includes(jd))
          )
          .map((item: { title?: string; domain?: string; url?: string; description?: string }) => ({
            title: item.title || "",
            source: item.domain || "",
            url: item.url || "",
            snippet: item.description?.substring(0, 200) || "",
          }))
          .slice(0, 20);

        const isHiring = postingsFound.length > 0;

        const jobData = {
          totalPostings: postingsFound.length,
          postings: postingsFound.length > 0 ? JSON.stringify(postingsFound) : null,
          isHiring,
          fetchedAt: new Date().toISOString(),
        };
        const existingJobs = await db.select({ id: jobPostings.id }).from(jobPostings).where(eq(jobPostings.installerId, task.installerId)).limit(1);
        if (existingJobs.length > 0) {
          await db.update(jobPostings).set(jobData).where(eq(jobPostings.installerId, task.installerId));
        } else {
          await db.insert(jobPostings).values({ installerId: task.installerId, ...jobData });
        }

        await db.update(dataforseoTasks).set({
          status: "completed",
          resultSummary: isHiring ? `Hiring: ${postingsFound.length} postings found` : "Not hiring",
          rawResult, completedAt: new Date().toISOString(),
        }).where(eq(dataforseoTasks.id, task.id));
      }

      collected++;
    } catch {
      errored++;
    }
    }));
  }

  return {
    collected,
    stillPending: stillPending + (timedOut ? pendingTasks.length - (collected + stillPending + errored + rejected) : 0),
    errored,
    rejected,
    rejectedMatches: rejectedMatches.slice(0, 20),
    total: pendingTasks.length,
    timedOut,
  };
}
