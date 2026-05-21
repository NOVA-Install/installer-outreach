import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  trustpilotReviews,
  marketingSignals,
  trafficData,
  websiteQuality,
} from "@/lib/db/schema";
import { sql, eq, like, or, and, count, desc, asc, type SQL } from "drizzle-orm";

export interface InstallerFilters {
  search?: string;
  county?: string;
  technology?: string;
  region?: string;
  tier?: string;
  pipelineStage?: string;
  boilerUpgradeScheme?: string;
  hasWebsite?: boolean;
  hasEmail?: boolean;
  hasReviews?: boolean;
  inMcs?: boolean;
  inNova?: boolean;
  inTrustMark?: boolean;
  scoreMin?: number;
  scoreMax?: number;
  ratingMin?: number;
  isShortlisted?: boolean;
  hasCrmTool?: boolean;
  crmToolName?: string;
  formType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function getInstallers(filters: InstallerFilters = {}) {
  const {
    search,
    county,
    technology,
    region,
    tier,
    pipelineStage,
    boilerUpgradeScheme,
    hasWebsite,
    hasEmail,
    hasReviews,
    inMcs,
    inNova,
    inTrustMark,
    scoreMin,
    scoreMax,
    ratingMin,
    isShortlisted,
    hasCrmTool,
    crmToolName,
    formType,
    page = 1,
    pageSize = 100,
    sortBy = "companyName",
    sortOrder = "asc",
  } = filters;

  const conditions: SQL[] = [];

  if (search) {
    const searchCondition = or(
      like(installers.companyName, `%${search}%`),
      like(installers.postcode, `%${search}%`),
      like(installers.email, `%${search}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (county) {
    conditions.push(eq(installers.county, county));
  }

  if (technology) {
    conditions.push(like(installers.technologiesCertified, `%${technology}%`));
  }

  if (region) {
    conditions.push(like(installers.regionsCovered, `%${region}%`));
  }

  if (boilerUpgradeScheme) {
    conditions.push(eq(installers.boilerUpgradeScheme, boilerUpgradeScheme));
  }

  if (tier) {
    conditions.push(eq(installerScores.tier, tier));
  }

  if (pipelineStage) {
    conditions.push(eq(installers.pipelineStage, pipelineStage));
  }

  if (hasWebsite === true) {
    conditions.push(sql`${installers.website} IS NOT NULL AND ${installers.website} != ''`);
  } else if (hasWebsite === false) {
    conditions.push(sql`(${installers.website} IS NULL OR ${installers.website} = '')`);
  }

  if (hasEmail === true) {
    conditions.push(sql`${installers.email} IS NOT NULL AND ${installers.email} != ''`);
  } else if (hasEmail === false) {
    conditions.push(sql`(${installers.email} IS NULL OR ${installers.email} = '')`);
  }

  if (hasReviews === true) {
    conditions.push(sql`${googleReviews.rating} IS NOT NULL OR ${trustpilotReviews.rating} IS NOT NULL`);
  } else if (hasReviews === false) {
    conditions.push(sql`${googleReviews.rating} IS NULL AND ${trustpilotReviews.rating} IS NULL`);
  }

  if (inMcs === true) {
    conditions.push(eq(installers.inMcs, true));
  }
  if (inNova === true) {
    conditions.push(eq(installers.inNova, true));
  }
  if (inTrustMark === true) {
    conditions.push(eq(installers.inTrustMark, true));
  }

  if (scoreMin != null) {
    conditions.push(sql`${installerScores.overallScore} >= ${scoreMin}`);
  }
  if (scoreMax != null) {
    conditions.push(sql`${installerScores.overallScore} <= ${scoreMax}`);
  }
  if (ratingMin != null) {
    conditions.push(sql`${googleReviews.rating} >= ${ratingMin}`);
  }

  if (isShortlisted === true) {
    conditions.push(eq(installers.isShortlisted, true));
  }

  if (hasCrmTool === true) {
    conditions.push(eq(marketingSignals.hasCrmTool, true));
  } else if (hasCrmTool === false) {
    conditions.push(sql`(${marketingSignals.hasCrmTool} IS NULL OR ${marketingSignals.hasCrmTool} = false)`);
  }

  if (crmToolName) {
    conditions.push(eq(marketingSignals.crmToolName, crmToolName));
  }

  if (formType) {
    conditions.push(eq(websiteQuality.formType, formType));
  }

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  // Sort column
  const sortMap = {
    companyName: installers.companyName,
    county: installers.county,
    postcode: installers.postcode,
    email: installers.email,
    telephone: installers.telephone,
    pipelineStage: installers.pipelineStage,
    priority: installers.priority,
    isShortlisted: installers.isShortlisted,
    overallScore: installerScores.overallScore,
    googleRating: googleReviews.rating,
    googleReviewCount: googleReviews.reviewCount,
    trustpilotRating: trustpilotReviews.rating,
    trustpilotReviewCount: trustpilotReviews.reviewCount,
    legalEntityName: installers.legalEntityName,
    website: installers.website,
    estimatedMonthlyInstalls: installerScores.estimatedMonthlyInstalls,
  } as unknown as Record<string, typeof installers.companyName>;

  // totalReviews is a computed column — handle separately
  const isTotalReviewsSort = sortBy === "totalReviews";
  const sortColumn = isTotalReviewsSort ? null : (sortMap[sortBy] || installers.companyName);

  // Nulls-last sort: for DESC, nulls go last naturally in Postgres for some types,
  // but for joined columns they appear first. Use NULLS LAST explicitly.
  let orderDir;
  if (isTotalReviewsSort) {
    const expr = sql`COALESCE(${googleReviews.reviewCount}, 0) + COALESCE(${trustpilotReviews.reviewCount}, 0)`;
    orderDir = sortOrder === "desc"
      ? sql`${expr} DESC NULLS LAST`
      : sql`${expr} ASC NULLS LAST`;
  } else {
    orderDir = sortOrder === "desc"
      ? sql`${sortColumn!} DESC NULLS LAST`
      : sql`${sortColumn!} ASC NULLS LAST`;
  }

  const results = await db
    .select({
      id: installers.id,
      installerId: installers.installerId,
      companyName: installers.companyName,
      email: installers.email,
      telephone: installers.telephone,
      website: installers.website,
      county: installers.county,
      postcode: installers.postcode,
      latitude: installers.latitude,
      longitude: installers.longitude,
      boilerUpgradeScheme: installers.boilerUpgradeScheme,
      technologiesCertified: installers.technologiesCertified,
      regionsCovered: installers.regionsCovered,
      pipelineStage: installers.pipelineStage,
      inMcs: installers.inMcs,
      inNova: installers.inNova,
      inTrustMark: installers.inTrustMark,
      sourceCount: installers.sourceCount,
      legalEntityName: installers.legalEntityName,
      legalEntityNumber: installers.legalEntityNumber,
      address: installers.address,
      country: installers.country,
      alternativeNames: installers.alternativeNames,
      isShortlisted: installers.isShortlisted,
      priority: installers.priority,
      priorityNote: installers.priorityNote,
      websiteStatus: installers.websiteStatus,
      // Scores
      overallScore: installerScores.overallScore,
      reputationScore: installerScores.reputationScore,
      marketingActivityScore: installerScores.marketingActivityScore,
      estimatedMonthlyInstalls: installerScores.estimatedMonthlyInstalls,
      tier: installerScores.tier,
      // Reviews
      googleRating: googleReviews.rating,
      googleReviewCount: googleReviews.reviewCount,
      googleReviewsPerMonth: googleReviews.reviewsPerMonth,
      trustpilotRating: trustpilotReviews.rating,
      trustpilotReviewCount: trustpilotReviews.reviewCount,
      // Marketing
      hasGoogleAnalytics: marketingSignals.hasGoogleAnalytics,
      hasGoogleAds: marketingSignals.hasGoogleAds,
      hasMetaPixel: marketingSignals.hasMetaPixel,
      hasCrmTool: marketingSignals.hasCrmTool,
      crmToolName: marketingSignals.crmToolName,
      hasLiveChat: marketingSignals.hasLiveChat,
      // Social
      facebookUrl: marketingSignals.facebookUrl,
      instagramUrl: marketingSignals.instagramUrl,
      linkedinUrl: marketingSignals.linkedinUrl,
      twitterUrl: marketingSignals.twitterUrl,
      youtubeUrl: marketingSignals.youtubeUrl,
      // Traffic
      googleOrganicEtv: trafficData.googleOrganicEtv,
      googlePaidEtv: trafficData.googlePaidEtv,
      // Source specific
      novaYearStarted: installers.novaYearStarted,
      trustmarkStatus: installers.trustmarkStatus,
      certificationBody: installers.certificationBody,
      // Website quality
      formType: websiteQuality.formType,
      performanceScore: websiteQuality.performanceScore,
      siteBuilder: websiteQuality.siteBuilder,
    })
    .from(installers)
    .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(trafficData, eq(installers.id, trafficData.installerId))
    .leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId))
    .where(whereClause)
    .orderBy(orderDir)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Simplified count - only join tables that are used in the WHERE clause
  const countQuery = db
    .select({ count: count() })
    .from(installers);

  // Only add joins needed for active filters
  if (tier || scoreMin != null || scoreMax != null) {
    countQuery.leftJoin(installerScores, eq(installers.id, installerScores.installerId));
  }
  if (hasReviews !== undefined || ratingMin != null) {
    countQuery.leftJoin(googleReviews, eq(installers.id, googleReviews.installerId));
    countQuery.leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId));
  }
  if (hasCrmTool !== undefined || crmToolName) {
    countQuery.leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId));
  }
  if (formType) {
    countQuery.leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId));
  }

  const [totalResult] = await countQuery.where(whereClause);

  return {
    data: results,
    total: totalResult?.count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((totalResult?.count ?? 0) / pageSize),
  };
}

export async function getInstallerById(id: number) {
  const [installer] = await db
    .select()
    .from(installers)
    .where(eq(installers.id, id))
    .limit(1);

  return installer ?? null;
}

export async function getDistinctCrmTools() {
  const results = await db
    .selectDistinct({ crmToolName: marketingSignals.crmToolName })
    .from(marketingSignals)
    .where(sql`${marketingSignals.crmToolName} IS NOT NULL AND ${marketingSignals.crmToolName} != ''`)
    .orderBy(asc(marketingSignals.crmToolName));

  return results.map((r) => r.crmToolName).filter(Boolean) as string[];
}

export async function getDistinctCounties() {
  const results = await db
    .selectDistinct({ county: installers.county })
    .from(installers)
    .where(sql`${installers.county} IS NOT NULL AND ${installers.county} != ''`)
    .orderBy(asc(installers.county));

  return results.map((r) => r.county).filter(Boolean) as string[];
}
