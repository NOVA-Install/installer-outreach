import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
  marketingSignals,
  installerScores,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function recalculateScores(jobId: number) {
  // Fetch ALL data in bulk with joins instead of per-installer queries
  const allData = await db
    .select({
      id: installers.id,
      gRating: googleReviews.rating,
      gReviewCount: googleReviews.reviewCount,
      gReviewsPerMonth: googleReviews.reviewsPerMonth,
      tpRating: trustpilotReviews.rating,
      chEmployeeCount: companiesHouseData.employeeCount,
      mktGA: marketingSignals.hasGoogleAnalytics,
      mktGAds: marketingSignals.hasGoogleAds,
      mktMeta: marketingSignals.hasMetaPixel,
      mktMetaAds: marketingSignals.hasMetaAds,
      mktCrm: marketingSignals.hasCrmTool,
      mktChat: marketingSignals.hasLiveChat,
      hasMkt: marketingSignals.id,
    })
    .from(installers)
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
    .leftJoin(companiesHouseData, eq(installers.id, companiesHouseData.installerId))
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId));

  await db.update(enrichmentJobs).set({
    totalItems: allData.length,
    processedItems: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  // Calculate all scores
  const scoresToUpsert: {
    installerId: number;
    reputationScore: number;
    estimatedMonthlyInstalls: number;
    marketingActivityScore: number;
    overallScore: number;
    tier: string;
  }[] = [];

  for (const row of allData) {
    // Reputation Score (0-100)
    let reputationScore = 0;
    let reputationWeightTotal = 0;

    if (row.gRating != null) {
      reputationScore += (row.gRating / 5) * 100 * 0.5;
      reputationWeightTotal += 0.5;
      const reviewFactor = Math.min((row.gReviewCount || 0) / 100, 1) * 100;
      reputationScore += reviewFactor * 0.3;
      reputationWeightTotal += 0.3;
    }

    if (row.tpRating != null) {
      reputationScore += (row.tpRating / 5) * 100 * 0.2;
      reputationWeightTotal += 0.2;
    }

    if (reputationWeightTotal > 0) {
      reputationScore = reputationScore / reputationWeightTotal;
    }

    // Estimated Monthly Installs
    let estimatedMonthlyInstalls = 0;
    if (row.gReviewsPerMonth != null && row.gReviewsPerMonth > 0) {
      estimatedMonthlyInstalls = row.gReviewsPerMonth * 15;
    }
    if (row.chEmployeeCount != null && row.chEmployeeCount > 0) {
      const employeeEstimate = row.chEmployeeCount * 4;
      estimatedMonthlyInstalls = estimatedMonthlyInstalls > 0
        ? (estimatedMonthlyInstalls + employeeEstimate) / 2
        : employeeEstimate;
    }

    // Marketing Activity Score (0-100)
    let marketingActivityScore = 0;
    if (row.hasMkt != null) {
      if (row.mktGA) marketingActivityScore += 10;
      if (row.mktGAds) marketingActivityScore += 15;
      if (row.mktMeta) marketingActivityScore += 15;
      if (row.mktMetaAds) marketingActivityScore += 20;
      if (row.mktCrm) marketingActivityScore += 15;
      if (row.mktChat) marketingActivityScore += 10;
      marketingActivityScore += 10; // has website
    }
    marketingActivityScore = Math.min(marketingActivityScore, 100);

    const hasAnyData = reputationWeightTotal > 0 || estimatedMonthlyInstalls > 0 || row.hasMkt != null;
    if (!hasAnyData) continue;

    const volumeScore = Math.min(estimatedMonthlyInstalls / 50, 1) * 100;
    const overallScore = reputationScore * 0.4 + volumeScore * 0.3 + marketingActivityScore * 0.3;
    const tier = overallScore >= 70 ? "high" : overallScore >= 40 ? "medium" : "low";

    scoresToUpsert.push({
      installerId: row.id,
      reputationScore,
      estimatedMonthlyInstalls,
      marketingActivityScore,
      overallScore,
      tier,
    });
  }

  // Batch upsert scores using ON CONFLICT
  let processed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < scoresToUpsert.length; i += 200) {
    const batch = scoresToUpsert.slice(i, i + 200);

    // Use raw SQL for fast bulk upsert
    for (const score of batch) {
      await db.execute(sql`
        INSERT INTO installer_scores (installer_id, reputation_score, estimated_monthly_installs, marketing_activity_score, overall_score, tier, last_calculated_at)
        VALUES (${score.installerId}, ${score.reputationScore}, ${score.estimatedMonthlyInstalls}, ${score.marketingActivityScore}, ${score.overallScore}, ${score.tier}, ${now})
        ON CONFLICT (installer_id) DO UPDATE SET
          reputation_score = EXCLUDED.reputation_score,
          estimated_monthly_installs = EXCLUDED.estimated_monthly_installs,
          marketing_activity_score = EXCLUDED.marketing_activity_score,
          overall_score = EXCLUDED.overall_score,
          tier = EXCLUDED.tier,
          last_calculated_at = EXCLUDED.last_calculated_at
      `);
    }

    processed += batch.length;
    await db.update(enrichmentJobs).set({ processedItems: processed }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: processed,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}
