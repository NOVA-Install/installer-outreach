import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
  marketingSignals,
  trafficData,
  seoData,
  googleAdsData,
  websiteQuality,
  jobPostings,
  googleBusinessInfo,
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
      // SEO
      domainAuthority: seoData.domainAuthority,
      hasSeo: seoData.id,
      // Google Ads Transparency
      adsTotalAds: googleAdsData.totalAds,
      hasAdsData: googleAdsData.id,
      // Website Quality
      wqPerformanceScore: websiteQuality.performanceScore,
      wqFormType: websiteQuality.formType,
      hasWq: websiteQuality.id,
      // Job Postings
      jpIsHiring: jobPostings.isHiring,
      hasJp: jobPostings.id,
      // Google Business Info
      gbIsClaimed: googleBusinessInfo.isClaimed,
      gbTotalPhotos: googleBusinessInfo.totalPhotos,
      hasGb: googleBusinessInfo.id,
    })
    .from(installers)
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
    .leftJoin(companiesHouseData, eq(installers.id, companiesHouseData.installerId))
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(trafficData, eq(installers.id, trafficData.installerId))
    .leftJoin(seoData, eq(installers.id, seoData.installerId))
    .leftJoin(googleAdsData, eq(installers.id, googleAdsData.installerId))
    .leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId))
    .leftJoin(jobPostings, eq(installers.id, jobPostings.installerId))
    .leftJoin(googleBusinessInfo, eq(installers.id, googleBusinessInfo.installerId));

  await db.update(enrichmentJobs).set({
    totalItems: allData.length,
    processedItems: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  const scoresToUpsert: {
    installerId: number;
    reputationScore: number;
    marketingActivityScore: number;
    overallScore: number;
    tier: string;
  }[] = [];

  for (const row of allData) {
    // ─── REPUTATION SCORE (0-100) ───
    // Weighted average of available review/trust signals
    let reputationScore = 0;
    let repWeightTotal = 0;

    if (row.gRating != null) {
      // Rating quality (0-100)
      reputationScore += (row.gRating / 5) * 100 * 0.30;
      repWeightTotal += 0.30;

      // Review volume signal (0-100, caps at 200 reviews)
      const gVolume = Math.min((row.gReviewCount || 0) / 200, 1) * 100;
      reputationScore += gVolume * 0.25;
      repWeightTotal += 0.25;
    }

    if (row.tpRating != null) {
      reputationScore += (row.tpRating / 5) * 100 * 0.15;
      repWeightTotal += 0.15;

      // Trustpilot volume (0-100, caps at 100 reviews)
      const tpVolume = Math.min((row.tpReviewCount || 0) / 100, 1) * 100;
      reputationScore += tpVolume * 0.10;
      repWeightTotal += 0.10;
    }

    // Company age bonus (longer = more established)
    if (row.chIncorporationDate) {
      const yearsOld = (Date.now() - new Date(row.chIncorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const ageFactor = Math.min(yearsOld / 15, 1) * 100; // caps at 15 years
      reputationScore += ageFactor * 0.10;
      repWeightTotal += 0.10;
    }

    // Google Business claimed = trust signal
    if (row.hasGb != null && row.gbIsClaimed) {
      reputationScore += 100 * 0.05;
      repWeightTotal += 0.05;
    }

    // Google Business photos (engaged business)
    if (row.hasGb != null && row.gbTotalPhotos != null && row.gbTotalPhotos > 0) {
      const photoFactor = Math.min(row.gbTotalPhotos / 20, 1) * 100;
      reputationScore += photoFactor * 0.05;
      repWeightTotal += 0.05;
    }

    if (repWeightTotal > 0) {
      reputationScore = reputationScore / repWeightTotal;
    }

    // ─── MARKETING ACTIVITY SCORE (0-100) ───
    // Weights: website=5, GA=8, GAds(pixel)=10, Meta=10, CRM=12, Chat=8,
    //          organic traffic=10, paid traffic=10, domain authority=8,
    //          confirmed ads=8, website perf=5, form quality=6 = 100 max
    let marketingActivityScore = 0;

    // Website presence
    if (row.website) marketingActivityScore += 5;

    // Tech detection signals
    if (row.hasMkt != null) {
      if (row.mktGA) marketingActivityScore += 8;
      if (row.mktGAds) marketingActivityScore += 10;
      if (row.mktMeta) marketingActivityScore += 10;
      if (row.mktCrm) marketingActivityScore += 12;
      if (row.mktChat) marketingActivityScore += 8;
    }

    // Traffic signals (organic presence = SEO investment)
    if (row.organicEtv != null && row.organicEtv > 0) {
      const trafficFactor = Math.min(row.organicEtv / 1000, 1) * 10;
      marketingActivityScore += trafficFactor;
    }

    // Paid traffic (actively spending on ads)
    if (row.paidEtv != null && row.paidEtv > 0) {
      marketingActivityScore += 10;
    }

    // Domain authority from SEO data
    if (row.hasSeo != null && row.domainAuthority != null && row.domainAuthority > 0) {
      marketingActivityScore += Math.min(row.domainAuthority / 100, 1) * 8;
    }

    // Confirmed active Google Ads (from Ads Transparency, not just pixel detection)
    if (row.hasAdsData != null && row.adsTotalAds != null && row.adsTotalAds > 0) {
      marketingActivityScore += 8;
    }

    // Website performance (PageSpeed score)
    if (row.hasWq != null && row.wqPerformanceScore != null && row.wqPerformanceScore > 50) {
      marketingActivityScore += (row.wqPerformanceScore / 100) * 5;
    }

    // Form quality (quote forms / multi-step = higher lead capture sophistication)
    if (row.hasWq != null && row.wqFormType) {
      if (row.wqFormType === "multi_step") marketingActivityScore += 6;
      else if (row.wqFormType === "quote_form") marketingActivityScore += 4;
    }

    marketingActivityScore = Math.min(marketingActivityScore, 100);

    // ─── OVERALL SCORE ───
    const hasAnyData = repWeightTotal > 0 ||
      row.hasMkt != null || row.organicEtv != null || row.hasSeo != null ||
      row.hasAdsData != null || row.hasWq != null || row.hasJp != null || row.hasGb != null;
    if (!hasAnyData) continue;

    // Overall = weighted blend of two dimensions:
    //   Reputation (0.45): review quality + volume + company age + business profile trust
    //   Marketing (0.55): digital sophistication — highest weight because it best predicts
    //     receptiveness to outreach and investment in growth. A company running GA + ads + CRM
    //     is more likely to engage with partnership proposals than one with no web presence.
    const overallScore =
      reputationScore * 0.45 +
      marketingActivityScore * 0.55;

    const tier =
      overallScore >= 65 ? "high" :
      overallScore >= 35 ? "medium" :
      "low";

    scoresToUpsert.push({
      installerId: row.id,
      reputationScore,
      marketingActivityScore,
      overallScore,
      tier,
    });
  }

  // Bulk upsert in batches of 200
  let processed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < scoresToUpsert.length; i += 200) {
    const batch = scoresToUpsert.slice(i, i + 200);

    if (batch.length > 0) {
      const valuesSql = batch.map((s) =>
        sql`(${s.installerId}, ${s.reputationScore}, ${s.marketingActivityScore}, ${s.overallScore}, ${s.tier}, ${now})`
      );

      await db.execute(sql`
        INSERT INTO installer_scores (installer_id, reputation_score, marketing_activity_score, overall_score, tier, last_calculated_at)
        VALUES ${sql.join(valuesSql, sql`, `)}
        ON CONFLICT (installer_id) DO UPDATE SET
          reputation_score = EXCLUDED.reputation_score,
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
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
}
