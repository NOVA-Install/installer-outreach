import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  enrichmentJobs,
  installers,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
  marketingSignals,
  seoData,
  installerScores,
  dataforseoTasks,
} from "@/lib/db/schema";
import { desc, count, sql, eq } from "drizzle-orm";

export async function GET() {
  // Get latest job per type
  const latestJobs = await db
    .select()
    .from(enrichmentJobs)
    .orderBy(desc(enrichmentJobs.createdAt))
    .limit(20);

  const jobsByType: Record<string, typeof latestJobs[0]> = {};
  for (const job of latestJobs) {
    if (!jobsByType[job.type]) {
      jobsByType[job.type] = job;
    }
  }

  // Get coverage stats
  const [totalInstallers] = await db
    .select({ count: count() })
    .from(installers);

  const total = totalInstallers?.count ?? 0;

  const [googleCount] = await db.select({ count: count() }).from(googleReviews);
  const [trustpilotCount] = await db.select({ count: count() }).from(trustpilotReviews);
  const [chCount] = await db.select({ count: count() }).from(companiesHouseData);
  const [marketingCount] = await db.select({ count: count() }).from(marketingSignals);
  const [seoCount] = await db.select({ count: count() }).from(seoData);
  const [scoresCount] = await db.select({ count: count() }).from(installerScores);

  // Pending DataForSEO tasks breakdown
  const taskStats = await db
    .select({
      source: dataforseoTasks.source,
      status: dataforseoTasks.status,
      count: count(),
    })
    .from(dataforseoTasks)
    .groupBy(dataforseoTasks.source, dataforseoTasks.status);

  const pendingTasks: Record<string, { pending: number; completed: number; failed: number; noResults: number; total: number }> = {};
  for (const row of taskStats) {
    if (!pendingTasks[row.source]) {
      pendingTasks[row.source] = { pending: 0, completed: 0, failed: 0, noResults: 0, total: 0 };
    }
    const entry = pendingTasks[row.source];
    entry.total += row.count;
    if (row.status === "pending") entry.pending += row.count;
    else if (row.status === "completed") entry.completed += row.count;
    else if (row.status === "failed") entry.failed += row.count;
    else if (row.status === "no_results") entry.noResults += row.count;
  }

  return NextResponse.json({
    total,
    coverage: {
      google_reviews: googleCount?.count ?? 0,
      trustpilot: trustpilotCount?.count ?? 0,
      companies_house: chCount?.count ?? 0,
      tech_detection: marketingCount?.count ?? 0,
      seo: seoCount?.count ?? 0,
      scores: scoresCount?.count ?? 0,
    },
    jobs: jobsByType,
    pendingTasks,
  });
}
