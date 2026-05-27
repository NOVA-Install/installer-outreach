import { inngest } from "./client";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Helper: create a job record and return its ID
async function createJob(type: string) {
  const [job] = await db
    .insert(enrichmentJobs)
    .values({ type, status: "running", totalItems: 0, processedItems: 0, errorCount: 0, startedAt: new Date().toISOString() })
    .returning();
  return job.id;
}

// Helper: mark a job as failed
async function failJob(jobId: number, error: unknown) {
  await db
    .update(enrichmentJobs)
    .set({
      status: "failed",
      errorLog: JSON.stringify([String(error)]),
      completedAt: new Date().toISOString(),
    })
    .where(eq(enrichmentJobs.id, jobId));
}

// Helper: update job progress
async function updateJobProgress(jobId: number, processed: number, errors: number, total?: number) {
  const update: Record<string, unknown> = {
    processedItems: processed,
    errorCount: errors,
  };
  if (total != null) update.totalItems = total;
  await db.update(enrichmentJobs).set(update).where(eq(enrichmentJobs.id, jobId));
}

// Helper: mark a job as completed
async function completeJob(jobId: number, processed: number, errors: number) {
  await db
    .update(enrichmentJobs)
    .set({
      processedItems: processed,
      errorCount: errors,
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(eq(enrichmentJobs.id, jobId));
}

// Helper: call a Supabase Edge Function and return parsed response
async function callEdgeFunction(name: string, body: Record<string, unknown> = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env vars not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3 min timeout

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Edge Function ${name} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

// Max iterations per Inngest function to prevent runaway
// Higher for 1-per-batch functions, lower for bulk functions
const MAX_BATCHES_SINGLE = 500; // tech detection, companies house (1 installer per call)
const MAX_BATCHES_BULK = 50;    // traffic, google ads, collect (many per call)

// ── Site Analysis (merged tech detection + website quality) ──────
// Fetches HTML once per installer, runs both analyses, writes to both tables

export const siteAnalysis = inngest.createFunction(
  { id: "enrich-site-analysis", retries: 3, triggers: [
    { event: "enrichment/site-analysis" },
    { event: "enrichment/tech-detection" },    // backwards compat
    { event: "enrichment/website-quality" },   // backwards compat
  ] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("site_analysis"));
    let totalProcessed = 0;
    let totalErrors = 0;
    let batch = 0;

    while (batch < 500) {
      const result = await step.run(`sa-batch-${batch}`, async () => {
        const { enrichSiteAnalysisBatch } = await import("@/lib/enrichment/site-analysis");
        return enrichSiteAnalysisBatch(20);
      });

      totalProcessed += result.processed || 0;
      totalErrors += result.errors || 0;
      const remaining = result.remaining ?? 0;

      await step.run(`update-progress-${batch}`, () =>
        updateJobProgress(jobId, totalProcessed, totalErrors, totalProcessed + remaining)
      );

      if (remaining <= 0) break;
      batch++;
    }

    await step.run("complete-job", () => completeJob(jobId, totalProcessed, totalErrors));
    return { jobId, totalProcessed, batches: batch + 1 };
  }
);

// ── Companies House ────────────────────────────────────────────
// 1 installer per Edge Function call, rate limited via step.sleep

export const companiesHouse = inngest.createFunction(
  { id: "enrich-companies-house", retries: 3, triggers: [{ event: "enrichment/companies-house" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("companies_house"));
    let totalProcessed = 0;
    let totalErrors = 0;
    let batch = 0;

    while (batch < MAX_BATCHES_SINGLE) {
      const result = await step.run(`ch-batch-${batch}`, () =>
        callEdgeFunction("companies-house-enrich", { skipJob: true })
      );

      totalProcessed += result.processed || 0;
      totalErrors += result.errors || 0;
      const remaining = result.remaining ?? 0;

      await step.run(`update-progress-${batch}`, () =>
        updateJobProgress(jobId, totalProcessed, totalErrors, totalProcessed + remaining)
      );

      if (remaining <= 0) break;
      // Rate limit: 600 req/5min. Each installer = 5 calls. Wait 3s between.
      await step.sleep(`rate-limit-${batch}`, "3s");
      batch++;
    }

    await step.run("complete-job", () => completeJob(jobId, totalProcessed, totalErrors));
    return { jobId, totalProcessed, batches: batch + 1 };
  }
);

// ── Traffic Bulk ───────────────────────────────────────────────
// Runs via Edge Function in batches (2000 per invocation)

export const trafficBulk = inngest.createFunction(
  { id: "enrich-traffic-bulk", retries: 3, triggers: [{ event: "enrichment/traffic-bulk" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("traffic_bulk"));
    let totalProcessed = 0;
    let totalErrors = 0;
    let batch = 0;

    while (batch < MAX_BATCHES_BULK) {
      const result = await step.run(`traffic-batch-${batch}`, () =>
        callEdgeFunction("traffic-bulk", { skipJob: true })
      );

      totalProcessed += result.processed || 0;
      totalErrors += result.errors || 0;
      const remaining = result.remaining ?? 0;

      await step.run(`update-progress-${batch}`, () =>
        updateJobProgress(jobId, totalProcessed, totalErrors, totalProcessed + remaining)
      );

      if (remaining <= 0) break;
      batch++;
    }

    await step.run("complete-job", () => completeJob(jobId, totalProcessed, totalErrors));
    return { jobId, totalProcessed, batches: batch + 1 };
  }
);

// (Website Quality merged into Site Analysis above)

// ── Google Reviews ─────────────────────────────────────────────

export const googleReviews = inngest.createFunction(
  { id: "enrich-google-reviews", retries: 3, triggers: [{ event: "enrichment/google-reviews" }] },
  async ({ event, step }) => {
    const priority = (event.data?.priority ?? 2) as 1 | 2;
    const jobId = await step.run("create-job", () => createJob("google_reviews"));

    await step.run("run-enrichment", async () => {
      const { enrichGoogleReviews } = await import("@/lib/enrichment/dataforseo");
      try {
        await enrichGoogleReviews(jobId, undefined, priority);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Trustpilot ─────────────────────────────────────────────────

export const trustpilotFn = inngest.createFunction(
  { id: "enrich-trustpilot", retries: 3, triggers: [{ event: "enrichment/trustpilot" }] },
  async ({ event, step }) => {
    const priority = (event.data?.priority ?? 2) as 1 | 2;
    const jobId = await step.run("create-job", () => createJob("trustpilot"));

    await step.run("run-enrichment", async () => {
      const { enrichTrustpilot } = await import("@/lib/enrichment/dataforseo");
      try {
        await enrichTrustpilot(jobId, undefined, priority);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Trustpilot Domain Fallback ──────────────────────────────────

export const trustpilotDomainFn = inngest.createFunction(
  { id: "enrich-trustpilot-domain", retries: 3, triggers: [{ event: "enrichment/trustpilot-domain" }] },
  async ({ event, step }) => {
    const priority = (event.data?.priority ?? 2) as 1 | 2;
    const jobId = await step.run("create-job", () => createJob("trustpilot_domain"));

    await step.run("run-enrichment", async () => {
      const { enrichTrustpilotDomainFallback } = await import("@/lib/enrichment/dataforseo");
      try {
        await enrichTrustpilotDomainFallback(jobId, priority);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Collect Results ────────────────────────────────────────────

export const collectResults = inngest.createFunction(
  { id: "enrich-collect-results", retries: 3, triggers: [{ event: "enrichment/collect-results" }] },
  async ({ step }) => {
    let totalCollected = 0;
    let batch = 0;

    while (batch < MAX_BATCHES_BULK) {
      const result = await step.run(`collect-batch-${batch}`, () =>
        callEdgeFunction("collect-results")
      );

      totalCollected += result.collected || 0;
      const stillPending = result.stillPending ?? 0;
      if (stillPending <= 0) break;
      batch++;
      // Wait between batches to let DataForSEO process more tasks
      if (stillPending > 0) {
        await step.sleep(`wait-${batch}`, "30s");
      }
    }

    return { totalCollected, batches: batch + 1 };
  }
);

// ── SEO / Backlinks ────────────────────────────────────────────

export const seoDataFn = inngest.createFunction(
  { id: "enrich-seo", retries: 3, triggers: [{ event: "enrichment/seo" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("seo"));

    await step.run("run-enrichment", async () => {
      const { enrichSeoData } = await import("@/lib/enrichment/dataforseo");
      try {
        await enrichSeoData(jobId);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Google Business ────────────────────────────────────────────

export const googleBusiness = inngest.createFunction(
  { id: "enrich-google-business", retries: 3, triggers: [{ event: "enrichment/google-business" }] },
  async ({ event, step }) => {
    const priority = (event.data?.priority ?? 2) as 1 | 2;
    const jobId = await step.run("create-job", () => createJob("google_business"));

    await step.run("run-enrichment", async () => {
      const { enrichGoogleBusinessBatch } = await import("@/lib/enrichment/google-business");
      try {
        await enrichGoogleBusinessBatch(jobId, priority);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Google Ads Transparency ────────────────────────────────────

export const googleAds = inngest.createFunction(
  { id: "enrich-google-ads", retries: 3, triggers: [{ event: "enrichment/google-ads" }] },
  async ({ event, step }) => {
    const minTraffic = event.data?.minTraffic ?? 0;
    const jobId = await step.run("create-job", () => createJob("google_ads_transparency"));
    let totalProcessed = 0;
    let totalErrors = 0;
    let batch = 0;

    while (batch < MAX_BATCHES_BULK) {
      const result = await step.run(`gads-batch-${batch}`, () =>
        callEdgeFunction("google-ads-transparency", { minTraffic, skipJob: true })
      );

      totalProcessed += result.processed || 0;
      totalErrors += result.errors || 0;
      const remaining = result.remaining ?? 0;

      await step.run(`update-progress-${batch}`, () =>
        updateJobProgress(jobId, totalProcessed, totalErrors, totalProcessed + remaining)
      );

      if (remaining <= 0) break;
      batch++;
    }

    await step.run("complete-job", () => completeJob(jobId, totalProcessed, totalErrors));
    return { jobId, totalProcessed, batches: batch + 1 };
  }
);

// ── Job Postings ───────────────────────────────────────────────

export const jobPostingsFn = inngest.createFunction(
  { id: "enrich-job-postings", retries: 3, triggers: [{ event: "enrichment/job-postings" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("job_postings"));

    await step.run("run-enrichment", async () => {
      const { enrichJobPostingsBatch } = await import("@/lib/enrichment/job-postings");
      try {
        await enrichJobPostingsBatch(jobId);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Scores ─────────────────────────────────────────────────────

export const scoresFn = inngest.createFunction(
  { id: "enrich-scores", retries: 3, triggers: [{ event: "enrichment/scores" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("scores"));

    await step.run("run-enrichment", async () => {
      const { recalculateScores } = await import("@/lib/enrichment/score-calculator");
      try {
        await recalculateScores(jobId);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// Export all functions for the serve handler
export const allFunctions = [
  siteAnalysis,
  companiesHouse,
  trafficBulk,
  googleReviews,
  trustpilotFn,
  trustpilotDomainFn,
  collectResults,
  seoDataFn,
  googleBusiness,
  googleAds,
  jobPostingsFn,
  scoresFn,
];
