import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  trustpilotReviews,
  marketingSignals,
  trafficData,
  websiteQuality,
  socialSignals,
} from "@/lib/db/schema";
import { sql, eq, like, or, and, count, desc, asc, inArray, type SQL } from "drizzle-orm";
import { getPrefixesForZones } from "@/lib/constants";

export interface InstallerFilters {
  search?: string;
  zones?: string[];
  counties?: string[];
  technology?: string;
  region?: string;
  tier?: string;
  pipelineStage?: string;
  boilerUpgradeScheme?: string;
  hasWebsite?: boolean;
  hasEmail?: boolean;
  hasGoogleReviews?: boolean;
  hasTrustpilot?: boolean;
  googleRatingMin?: number;
  trustpilotRatingMin?: number;
  reviewCountMin?: number;
  inMcs?: boolean;
  inNova?: boolean;
  inTrustMark?: boolean;
  scoreMin?: number;
  scoreMax?: number;
  isShortlisted?: boolean;
  hasCrmTool?: boolean;
  crmToolName?: string;
  formType?: string;
  hasAgency?: boolean;
  agencyName?: string;
  originLat?: number;
  originLng?: number;
  maxDistanceKm?: number;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function getInstallers(filters: InstallerFilters = {}) {
  const {
    search,
    zones,
    counties,
    technology,
    region,
    tier,
    pipelineStage,
    boilerUpgradeScheme,
    hasWebsite,
    hasEmail,
    hasGoogleReviews,
    hasTrustpilot,
    googleRatingMin,
    trustpilotRatingMin,
    reviewCountMin,
    inMcs,
    inNova,
    inTrustMark,
    scoreMin,
    scoreMax,
    isShortlisted,
    hasCrmTool,
    crmToolName,
    formType,
    hasAgency,
    agencyName,
    originLat,
    originLng,
    maxDistanceKm,
    page = 1,
    pageSize = 100,
    sortBy = "companyName",
    sortOrder = "asc",
  } = filters;

  // Determine which tables need to be joined for this query
  const needsScores = true; // always needed — default sort is overallScore, score/tier are default columns
  const needsGoogleReviews = true; // always needed — googleReviews is a default column
  const needsTrustpilot = true; // always needed — trustpilotReviews is a default column
  const needsMarketing = hasCrmTool !== undefined || !!crmToolName;
  const needsTraffic = false; // only needed if traffic columns are visible (not in default set)
  const needsQuality = !!formType || hasAgency !== undefined || !!agencyName;

  const conditions: SQL[] = [];

  if (search) {
    const searchCondition = or(
      like(installers.companyName, `%${search}%`),
      like(installers.alternativeNames, `%${search}%`),
      like(installers.postcode, `%${search}%`),
      like(installers.email, `%${search}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  // Location: zones and/or counties (OR between them)
  const locationConditions: SQL[] = [];

  if (zones && zones.length > 0) {
    const prefixes = getPrefixesForZones(zones);
    if (prefixes.length > 0) {
      const prefixConditions = prefixes.map(p =>
        p.length === 1
          ? sql`UPPER(${installers.postcode}) ~ ${`^${p}[0-9]`}`
          : sql`UPPER(${installers.postcode}) LIKE ${`${p.toUpperCase()}%`}`
      );
      locationConditions.push(sql`(${sql.join(prefixConditions, sql` OR `)})`);
    }
  }

  if (counties && counties.length > 0) {
    locationConditions.push(inArray(installers.county, counties));
  }

  if (locationConditions.length === 1) {
    conditions.push(locationConditions[0]);
  } else if (locationConditions.length > 1) {
    conditions.push(or(...locationConditions)!);
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

  if (hasGoogleReviews === true) {
    conditions.push(sql`${googleReviews.reviewCount} IS NOT NULL AND ${googleReviews.reviewCount} > 0`);
  } else if (hasGoogleReviews === false) {
    conditions.push(sql`(${googleReviews.reviewCount} IS NULL OR ${googleReviews.reviewCount} = 0)`);
  }

  if (hasTrustpilot === true) {
    conditions.push(sql`${trustpilotReviews.reviewCount} IS NOT NULL AND ${trustpilotReviews.reviewCount} > 0`);
  } else if (hasTrustpilot === false) {
    conditions.push(sql`(${trustpilotReviews.reviewCount} IS NULL OR ${trustpilotReviews.reviewCount} = 0)`);
  }

  if (googleRatingMin != null) {
    conditions.push(sql`${googleReviews.rating} >= ${googleRatingMin}`);
  }
  if (trustpilotRatingMin != null) {
    conditions.push(sql`${trustpilotReviews.rating} >= ${trustpilotRatingMin}`);
  }
  if (reviewCountMin != null) {
    conditions.push(sql`COALESCE(${googleReviews.reviewCount}, 0) + COALESCE(${trustpilotReviews.reviewCount}, 0) >= ${reviewCountMin}`);
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

  if (hasAgency === true) {
    conditions.push(sql`${websiteQuality.agencyName} IS NOT NULL AND ${websiteQuality.agencyName} != ''`);
  } else if (hasAgency === false) {
    conditions.push(sql`(${websiteQuality.agencyName} IS NULL OR ${websiteQuality.agencyName} = '')`);
  }

  if (agencyName) {
    conditions.push(eq(websiteQuality.agencyName, agencyName));
  }

  if (maxDistanceKm != null && originLat != null && originLng != null) {
    const maxMiles = maxDistanceKm * 0.621371;
    conditions.push(
      sql`${installers.latitude} IS NOT NULL AND ${installers.longitude} IS NOT NULL AND
        ACOS(LEAST(1, GREATEST(-1,
          SIN(RADIANS(${originLat})) * SIN(RADIANS(${installers.latitude})) +
          COS(RADIANS(${originLat})) * COS(RADIANS(${installers.latitude})) *
          COS(RADIANS(${installers.longitude}) - RADIANS(${originLng}))
        ))) * 3958.8 <= ${maxMiles}`
    );
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
  } as unknown as Record<string, typeof installers.companyName>;

  // totalReviews is a computed column — handle separately
  const isTotalReviewsSort = sortBy === "totalReviews";
  const isDistanceSort = sortBy === "distance" && originLat != null && originLng != null;
  const sortColumn = (isTotalReviewsSort || isDistanceSort) ? null : (sortMap[sortBy] || installers.companyName);

  // Nulls-last sort: for DESC, nulls go last naturally in Postgres for some types,
  // but for joined columns they appear first. Use NULLS LAST explicitly.
  let orderDir;
  if (isDistanceSort) {
    const distExpr = sql`(
      ACOS(
        LEAST(1, GREATEST(-1,
          SIN(RADIANS(${originLat})) * SIN(RADIANS(${installers.latitude})) +
          COS(RADIANS(${originLat})) * COS(RADIANS(${installers.latitude})) *
          COS(RADIANS(${installers.longitude}) - RADIANS(${originLng}))
        ))
      ) * 3958.8
    )`;
    orderDir = sql`${distExpr} ASC NULLS LAST`;
  } else if (isTotalReviewsSort) {
    const expr = sql`COALESCE(${googleReviews.reviewCount}, 0) + COALESCE(${trustpilotReviews.reviewCount}, 0)`;
    orderDir = sortOrder === "desc"
      ? sql`${expr} DESC NULLS LAST`
      : sql`${expr} ASC NULLS LAST`;
  } else {
    orderDir = sortOrder === "desc"
      ? sql`${sortColumn!} DESC NULLS LAST`
      : sql`${sortColumn!} ASC NULLS LAST`;
  }

  // Single query: data + total count via window function (eliminates second DB round-trip)
  // Always-joined: installerScores, googleReviews, trustpilotReviews (used in default columns/sort)
  // Conditional: marketingSignals, trafficData, websiteQuality (only when filters need them)
  const dataQuery = db
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
      // Scores (always joined)
      overallScore: installerScores.overallScore,
      reputationScore: installerScores.reputationScore,
      marketingActivityScore: installerScores.marketingActivityScore,
      tier: installerScores.tier,
      // Reviews (always joined)
      googleRating: googleReviews.rating,
      googleReviewCount: googleReviews.reviewCount,
      googleReviewsPerMonth: googleReviews.reviewsPerMonth,
      trustpilotRating: trustpilotReviews.rating,
      trustpilotReviewCount: trustpilotReviews.reviewCount,
      // Marketing (conditional)
      hasGoogleAnalytics: needsMarketing ? marketingSignals.hasGoogleAnalytics : sql<boolean | null>`NULL`.as("has_google_analytics"),
      hasGoogleAds: needsMarketing ? marketingSignals.hasGoogleAds : sql<boolean | null>`NULL`.as("has_google_ads"),
      hasMetaPixel: needsMarketing ? marketingSignals.hasMetaPixel : sql<boolean | null>`NULL`.as("has_meta_pixel"),
      hasCrmTool: needsMarketing ? marketingSignals.hasCrmTool : sql<boolean | null>`NULL`.as("has_crm_tool"),
      crmToolName: needsMarketing ? marketingSignals.crmToolName : sql<string | null>`NULL`.as("crm_tool_name"),
      hasLiveChat: needsMarketing ? marketingSignals.hasLiveChat : sql<boolean | null>`NULL`.as("has_live_chat"),
      facebookUrl: needsMarketing ? marketingSignals.facebookUrl : sql<string | null>`NULL`.as("facebook_url"),
      instagramUrl: needsMarketing ? marketingSignals.instagramUrl : sql<string | null>`NULL`.as("instagram_url"),
      linkedinUrl: needsMarketing ? marketingSignals.linkedinUrl : sql<string | null>`NULL`.as("linkedin_url"),
      twitterUrl: needsMarketing ? marketingSignals.twitterUrl : sql<string | null>`NULL`.as("twitter_url"),
      youtubeUrl: needsMarketing ? marketingSignals.youtubeUrl : sql<string | null>`NULL`.as("youtube_url"),
      // Traffic (conditional)
      googleOrganicEtv: needsTraffic ? trafficData.googleOrganicEtv : sql<number | null>`NULL`.as("google_organic_etv"),
      googlePaidEtv: needsTraffic ? trafficData.googlePaidEtv : sql<number | null>`NULL`.as("google_paid_etv"),
      // Source specific
      novaYearStarted: installers.novaYearStarted,
      trustmarkStatus: installers.trustmarkStatus,
      certificationBody: installers.certificationBody,
      // Website quality (conditional)
      formType: needsQuality ? websiteQuality.formType : sql<string | null>`NULL`.as("form_type"),
      performanceScore: needsQuality ? websiteQuality.performanceScore : sql<number | null>`NULL`.as("performance_score"),
      siteBuilder: needsQuality ? websiteQuality.siteBuilder : sql<string | null>`NULL`.as("site_builder"),
      // Computed distance (miles) from origin, null if no origin
      distance: originLat != null && originLng != null
        ? sql<number>`CASE WHEN ${installers.latitude} IS NOT NULL AND ${installers.longitude} IS NOT NULL THEN
            ACOS(LEAST(1, GREATEST(-1,
              SIN(RADIANS(${originLat})) * SIN(RADIANS(${installers.latitude})) +
              COS(RADIANS(${originLat})) * COS(RADIANS(${installers.latitude})) *
              COS(RADIANS(${installers.longitude}) - RADIANS(${originLng}))
            ))) * 3958.8
          ELSE NULL END`
        : sql<number | null>`NULL`,
      // LinkedIn social signal count (safe — returns 0 if table not yet created)
      socialSignalCount: sql<number>`CASE WHEN to_regclass('social_signals') IS NOT NULL THEN (SELECT COUNT(*) FROM social_signals WHERE social_signals.installer_id = ${installers.id}) ELSE 0 END`.as("social_signal_count"),
      // Window function: total matching rows (avoids separate count query)
      _total: sql<number>`COUNT(*) OVER()`.as("_total"),
    })
    .from(installers)
    .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
    .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId));

  // Conditionally add remaining joins
  if (needsMarketing) {
    dataQuery.leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId));
  }
  if (needsTraffic) {
    dataQuery.leftJoin(trafficData, eq(installers.id, trafficData.installerId));
  }
  if (needsQuality) {
    dataQuery.leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId));
  }

  dataQuery.where(whereClause).orderBy(orderDir).limit(pageSize).offset((page - 1) * pageSize);

  const t0 = performance.now();
  const results = await dataQuery;
  const dbMs = (performance.now() - t0).toFixed(0);
  console.log(`[getInstallers] db=${dbMs}ms joins=${needsMarketing ? 4 : 3} rows=${results.length}`);
  const total = results.length > 0 ? results[0]._total : 0;

  // Strip the _total field from each row before returning
  const data = results.map(({ _total, ...row }) => row);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
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

export async function getDistinctAgencies() {
  const results = await db
    .selectDistinct({ agencyName: websiteQuality.agencyName })
    .from(websiteQuality)
    .where(sql`${websiteQuality.agencyName} IS NOT NULL AND ${websiteQuality.agencyName} != ''`)
    .orderBy(asc(websiteQuality.agencyName));

  return results.map((r) => r.agencyName).filter(Boolean) as string[];
}
