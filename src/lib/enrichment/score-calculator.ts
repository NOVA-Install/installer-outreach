import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
  marketingSignals,
  trafficData,
  installerScores,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function recalculateScores(jobId: number) {
  // Fetch ALL data in bulk with joins
  const allData = await db
    .select({
      id: installers.id,
      website: installers.website,
      // Google Reviews
      gRating: googleReviews.rating,
      gReviewCount: googleReviews.reviewCount,
      gReviewsPerMonth: googleReviews.reviewsPerMonth,
      // Trustpilot
      tpRating: trustpilotReviews.rating,
      tpReviewCount: trustpilotReviews.reviewCount,
      // Companies House
      chEmployeeCount: companiesHouseData.employeeCount,
      chStatus: companiesHouseData.companyStatus,
      chIncorporationDate: companiesHouseData.incorporationDate,
      // Marketing signals
      mktGA: marketingSignals.hasGoogleAnalytics,
      mktGAds: marketingSignals.hasGoogleAds,
      mktMeta: marketingSignals.hasMetaPixel,
      mktCrm: marketingSignals.hasCrmTool,
      mktChat: marketingSignals.hasLiveChat,
      hasMkt: marketingSignals.id,
      // Traffic
      organicEtv: trafficData.googleOrganicEtv,
      paidEtv: trafficData.googlePaidEtv,
      organicCount: trafficData.googleOrganicCount,
    })
    .from(installers)
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
    .leftJoin(companiesHouseData, eq(installers.id, companiesHouseData.installerId))
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(trafficData, eq(installers.id, trafficData.installerId));

  await db.update(enrichmentJobs).set({
    totalItems: allData.length,
    processedItems: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  const scoresToUpsert: {
    installerId: number;
    reputationScore: number;
    estimatedMonthlyInstalls: number;
    marketingActivityScore: number;
    overallScore: number;
    tier: string;
  }[] = [];

  for (const row of allData) {
    // ─── REPUTATION SCORE (0-100) ───
    // Weighted average of available review signals
    let reputationScore = 0;
    let repWeightTotal = 0;

    if (row.gRating != null) {
      // Rating quality (0-100)
      reputationScore += (row.gRating / 5) * 100 * 0.35;
      repWeightTotal += 0.35;

      // Review volume signal (0-100, caps at 200 reviews)
      const gVolume = Math.min((row.gReviewCount || 0) / 200, 1) * 100;
      reputationScore += gVolume * 0.25;
      repWeightTotal += 0.25;
    }

    if (row.tpRating != null) {
      reputationScore += (row.tpRating / 5) * 100 * 0.2;
      repWeightTotal += 0.2;

      // Trustpilot volume (0-100, caps at 100 reviews)
      const tpVolume = Math.min((row.tpReviewCount || 0) / 100, 1) * 100;
      reputationScore += tpVolume * 0.1;
      repWeightTotal += 0.1;
    }

    // Company age bonus (longer = more established)
    if (row.chIncorporationDate) {
      const yearsOld = (Date.now() - new Date(row.chIncorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const ageFactor = Math.min(yearsOld / 15, 1) * 100; // caps at 15 years
      reputationScore += ageFactor * 0.1;
      repWeightTotal += 0.1;
    }

    if (repWeightTotal > 0) {
      reputationScore = reputationScore / repWeightTotal;
    }

    // ─── ESTIMATED MONTHLY INSTALLS ───
    let estimatedMonthlyInstalls = 0;

    // From review frequency
    if (row.gReviewsPerMonth != null && row.gReviewsPerMonth > 0) {
      estimatedMonthlyInstalls = row.gReviewsPerMonth * 15;
    }

    // From employee count (if available)
    if (row.chEmployeeCount != null && row.chEmployeeCount > 0) {
      const employeeEstimate = row.chEmployeeCount * 4;
      estimatedMonthlyInstalls = estimatedMonthlyInstalls > 0
        ? (estimatedMonthlyInstalls + employeeEstimate) / 2
        : employeeEstimate;
    }

    // ─── MARKETING ACTIVITY SCORE (0-100) ───
    let marketingActivityScore = 0;

    // Website presence
    if (row.website) marketingActivityScore += 5;

    // Tech detection signals
    if (row.hasMkt != null) {
      if (row.mktGA) marketingActivityScore += 10;
      if (row.mktGAds) marketingActivityScore += 15;
      if (row.mktMeta) marketingActivityScore += 15;
      if (row.mktCrm) marketingActivityScore += 15;
      if (row.mktChat) marketingActivityScore += 10;
    }

    // Traffic signals (organic presence = SEO investment)
    if (row.organicEtv != null && row.organicEtv > 0) {
      // Scale: 0-100 ETV = low, 100-1000 = medium, 1000+ = high
      const trafficFactor = Math.min(row.organicEtv / 1000, 1) * 15;
      marketingActivityScore += trafficFactor;
    }

    // Paid traffic (actively spending on ads)
    if (row.paidEtv != null && row.paidEtv > 0) {
      marketingActivityScore += 15;
    }

    marketingActivityScore = Math.min(marketingActivityScore, 100);

    // ─── OVERALL SCORE ───
    const hasAnyData = repWeightTotal > 0 || estimatedMonthlyInstalls > 0 || row.hasMkt != null || row.organicEtv != null;
    if (!hasAnyData) continue;

    const volumeScore = Math.min(estimatedMonthlyInstalls / 50, 1) * 100;

    const overallScore =
      reputationScore * 0.35 +
      volumeScore * 0.25 +
      marketingActivityScore * 0.40;

    const tier =
      overallScore >= 65 ? "high" :
      overallScore >= 35 ? "medium" :
      "low";

    scoresToUpsert.push({
      installerId: row.id,
      reputationScore,
      estimatedMonthlyInstalls,
      marketingActivityScore,
      overallScore,
      tier,
    });
  }

  // Batch upsert
  let processed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < scoresToUpsert.length; i += 200) {
    const batch = scoresToUpsert.slice(i, i + 200);

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
