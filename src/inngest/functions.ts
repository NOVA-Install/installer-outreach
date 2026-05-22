import { inngest } from "./client";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Helper: create a job record and return its ID
async function createJob(type: string) {
  const [job] = await db
    .insert(enrichmentJobs)
    .values({ type, status: "pending", totalItems: 0, processedItems: 0, errorCount: 0 })
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

// ── Tech Detection ─────────────────────────────────────────────

export const techDetection = inngest.createFunction(
  { id: "enrich-tech-detection", retries: 1, triggers: [{ event: "enrichment/tech-detection" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("tech_detection"));

    await step.run("run-enrichment", async () => {
      const { enrichTechDetection } = await import("@/lib/enrichment/tech-detection");
      try {
        await enrichTechDetection(jobId);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Companies House ────────────────────────────────────────────

export const companiesHouse = inngest.createFunction(
  { id: "enrich-companies-house", retries: 1, triggers: [{ event: "enrichment/companies-house" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("companies_house"));

    await step.run("run-enrichment", async () => {
      const { enrichCompaniesHouse } = await import("@/lib/enrichment/companies-house");
      try {
        await enrichCompaniesHouse(jobId);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Website Quality ────────────────────────────────────────────

export const websiteQuality = inngest.createFunction(
  { id: "enrich-website-quality", retries: 1, triggers: [{ event: "enrichment/website-quality" }] },
  async ({ step }) => {
    const jobId = await step.run("create-job", () => createJob("website_quality"));

    await step.run("run-enrichment", async () => {
      const { enrichWebsiteQuality } = await import("@/lib/enrichment/website-quality");
      try {
        await enrichWebsiteQuality(jobId);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Google Reviews ─────────────────────────────────────────────

export const googleReviews = inngest.createFunction(
  { id: "enrich-google-reviews", retries: 1, triggers: [{ event: "enrichment/google-reviews" }] },
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
  { id: "enrich-trustpilot", retries: 1, triggers: [{ event: "enrichment/trustpilot" }] },
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

// ── SEO / Backlinks ────────────────────────────────────────────

export const seoDataFn = inngest.createFunction(
  { id: "enrich-seo", retries: 1, triggers: [{ event: "enrichment/seo" }] },
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
  { id: "enrich-google-business", retries: 1, triggers: [{ event: "enrichment/google-business" }] },
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
  { id: "enrich-google-ads", retries: 1, triggers: [{ event: "enrichment/google-ads" }] },
  async ({ event, step }) => {
    const minTraffic = event.data?.minTraffic ?? 0;
    const jobId = await step.run("create-job", () => createJob("google_ads_transparency"));

    await step.run("run-enrichment", async () => {
      const { enrichGoogleAdsBatch } = await import("@/lib/enrichment/google-ads-transparency");
      try {
        await enrichGoogleAdsBatch(jobId, minTraffic);
      } catch (err) {
        await failJob(jobId, err);
        throw err;
      }
    });

    return { jobId };
  }
);

// ── Job Postings ───────────────────────────────────────────────

export const jobPostingsFn = inngest.createFunction(
  { id: "enrich-job-postings", retries: 1, triggers: [{ event: "enrichment/job-postings" }] },
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
  { id: "enrich-scores", retries: 1, triggers: [{ event: "enrichment/scores" }] },
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
  techDetection,
  companiesHouse,
  websiteQuality,
  googleReviews,
  trustpilotFn,
  seoDataFn,
  googleBusiness,
  googleAds,
  jobPostingsFn,
  scoresFn,
];
