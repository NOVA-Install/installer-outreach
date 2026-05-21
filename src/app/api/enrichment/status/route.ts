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
  trafficData,
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
  const [trafficCount] = await db
    .select({ count: count() })
    .from(trafficData)
    .where(sql`${trafficData.googleOrganicEtv} IS NOT NULL OR ${trafficData.googlePaidEtv} IS NOT NULL OR ${trafficData.bingOrganicEtv} IS NOT NULL`);
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

  // Match method breakdown for completed tasks
  const matchBreakdown = await db.execute(sql`
    SELECT
      source,
      CASE
        WHEN result_summary LIKE 'Auto-matched%' OR result_summary LIKE 'exact:%' OR result_summary LIKE 'close:%' OR result_summary LIKE 'overlap%' THEN 'auto_matched'
        WHEN result_summary LIKE 'AI verified%' OR result_summary LIKE 'ai_verified:%' THEN 'ai_verified'
        WHEN result_summary LIKE 'AI rejected%' OR result_summary LIKE 'Rejected%' THEN 'ai_rejected'
        WHEN result_summary LIKE 'AI matched%' OR result_summary LIKE 'Matched%' THEN 'matched'
        WHEN result_summary LIKE 'Saved (AI unavailable)%' OR result_summary LIKE 'ai_unavailable:%' THEN 'ai_unavailable'
        WHEN result_summary LIKE 'No results found' OR result_summary LIKE 'No UK results' OR result_summary LIKE 'No match%' THEN 'no_results'
        WHEN result_summary LIKE 'No rating%' THEN 'no_rating'
        WHEN result_summary LIKE 'name_mismatch%' THEN 'ai_rejected'
        ELSE 'other'
      END as match_method,
      COUNT(*) as cnt
    FROM dataforseo_tasks
    WHERE status IN ('completed', 'no_results')
    GROUP BY source, match_method
    ORDER BY source, cnt DESC
  `);

  return NextResponse.json({
    total,
    matchBreakdown: matchBreakdown as unknown as Record<string, unknown>[],
    coverage: {
      google_reviews: googleCount?.count ?? 0,
      trustpilot: trustpilotCount?.count ?? 0,
      companies_house: chCount?.count ?? 0,
      tech_detection: marketingCount?.count ?? 0,
      seo: seoCount?.count ?? 0,
      traffic: trafficCount?.count ?? 0,
      scores: scoresCount?.count ?? 0,
    },
    jobs: jobsByType,
    pendingTasks,
  });
}
