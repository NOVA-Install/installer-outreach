import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  seoData,
  enrichmentJobs,
  dataforseoTasks,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { RateLimiter } from "./rate-limiter";

const BASE_URL = "https://api.dataforseo.com/v3";

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
    const [currentJob] = await db.select({ status: enrichmentJobs.status }).from(enrichmentJobs).where(eq(enrichmentJobs.id, jobId)).limit(1);
    if (currentJob?.status === "cancelled") break;

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
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
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
    const [currentJob] = await db.select({ status: enrichmentJobs.status }).from(enrichmentJobs).where(eq(enrichmentJobs.id, jobId)).limit(1);
    if (currentJob?.status === "cancelled") break;

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
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
}

// Trustpilot - Phase 2: domain fallback for unmatched installers
// Call this after collecting results from Phase 1
export async function enrichTrustpilotDomainFallback(jobId: number, priority: 1 | 2 = 1) {
  // Exclude installers that already have a pending/completed domain search task
  const existingDomainTasks = db
    .select({ installerId: dataforseoTasks.installerId })
    .from(dataforseoTasks)
    .where(sql`${dataforseoTasks.source} = 'trustpilot_search' AND ${dataforseoTasks.searchTerm} LIKE '[domain%' AND ${dataforseoTasks.status} IN ('pending', 'completed')`);

  // Find installers that still don't have trustpilot data and have a website
  const unmatched = await db
    .select({ id: installers.id, companyName: installers.companyName, website: installers.website })
    .from(installers)
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
    .where(sql`${trustpilotReviews.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != '' AND ${installers.id} NOT IN (${existingDomainTasks})`);

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
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
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
          const seoValues = {
            installerId: installer.id,
            domainAuthority: data.rank || null,
            backlinksCount: data.backlinks || 0,
            referringDomains: data.referring_domains || 0,
            organicKeywords: null,
            fetchedAt: new Date().toISOString(),
          };
          await db.insert(seoData).values(seoValues)
            .onConflictDoUpdate({ target: seoData.installerId, set: seoValues });
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
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
}

// collectPendingResults removed — now handled by Supabase Edge Function (supabase/functions/collect-results/)
