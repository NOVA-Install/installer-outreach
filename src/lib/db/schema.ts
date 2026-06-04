import { pgTable, text, integer, real, serial, boolean, timestamp, unique } from "drizzle-orm/pg-core";

// Core installer data
export const installers = pgTable("installers", {
  id: serial("id").primaryKey(),
  installerId: text("installer_id").unique(),
  companyName: text("company_name").notNull(),
  alternativeNames: text("alternative_names"),
  legalEntityName: text("legal_entity_name"), // Companies House registered name
  legalEntityNumber: text("legal_entity_number"), // Companies House number
  websiteStatus: text("website_status"), // null | "found" | "not_found" | "pending_review"
  certificationNumber: text("certification_number"),
  certificationBody: text("certification_body"),
  // Primary values (user-selectable)
  email: text("email"),
  telephone: text("telephone"),
  website: text("website"),
  address: text("address"),
  county: text("county"),
  postcode: text("postcode"),
  country: text("country"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Multi-source values: JSON arrays of { value, source }
  websiteSources: text("website_sources"),
  emailSources: text("email_sources"),
  telephoneSources: text("telephone_sources"),
  addressSources: text("address_sources"),
  companyNameSources: text("company_name_sources"),
  // Source flags
  inNova: boolean("in_nova"),
  inMcs: boolean("in_mcs"),
  inTrustMark: boolean("in_trustmark"),
  sourceCount: integer("source_count"),
  // MCS specific
  boilerUpgradeScheme: text("boiler_upgrade_scheme"),
  technologiesCertified: text("technologies_certified"),
  regionsCovered: text("regions_covered"),
  // Nova specific
  novaYearStarted: text("nova_year_started"),
  novaBatteryStorage: text("nova_battery_storage"),
  novaLocationArea: text("nova_location_area"),
  novaIncorporatedName: text("nova_incorporated_name"),
  novaEnfProfileUrl: text("nova_enf_profile_url"),
  // TrustMark specific
  trustmarkTmln: text("trustmark_tmln"),
  trustmarkDistrict: text("trustmark_district"),
  trustmarkRegion: text("trustmark_region"),
  trustmarkNationalCoverage: text("trustmark_national_coverage"),
  trustmarkSchemeProviders: text("trustmark_scheme_providers"),
  trustmarkMemberSince: text("trustmark_member_since"),
  trustmarkDescription: text("trustmark_description"),
  trustmarkProfileUrl: text("trustmark_profile_url"),
  trustmarkStatus: text("trustmark_status"),
  // Shortlist & priority
  isShortlisted: boolean("is_shortlisted").default(false),
  priority: integer("priority"), // 1=highest, 2, 3, 4, 5=lowest. null=unset
  priorityNote: text("priority_note"), // optional note about why this priority
  // CRM
  pipelineStage: text("pipeline_stage").default("uncontacted"),
  pipelineStageUpdatedAt: text("pipeline_stage_updated_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Google Reviews enrichment
export const googleReviews = pgTable("google_reviews", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  placeId: text("place_id"),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  reviewsPerMonth: real("reviews_per_month"),
  businessStatus: text("business_status"),
  fetchedAt: text("fetched_at").notNull(),
});

// Trustpilot enrichment
export const trustpilotReviews = pgTable("trustpilot_reviews", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  trustpilotUrl: text("trustpilot_url"),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  trustScore: real("trust_score"),
  fetchedAt: text("fetched_at").notNull(),
});

// Individual review items
export const reviewItems = pgTable("review_items", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  source: text("source").notNull(),
  rating: real("rating"),
  reviewText: text("review_text"),
  reviewerName: text("reviewer_name"),
  reviewDate: text("review_date"),
  fetchedAt: text("fetched_at").notNull(),
});

// Companies House data
export const companiesHouseData = pgTable("companies_house_data", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  companyNumber: text("company_number"),
  companyStatus: text("company_status"),
  incorporationDate: text("incorporation_date"),
  companyType: text("company_type"),
  sicCodes: text("sic_codes"),
  registeredAddress: text("registered_address"),
  lastAccountsDate: text("last_accounts_date"),
  accountCategory: text("account_category"),
  employeeCount: integer("employee_count"),
  officers: text("officers"),
  personsOfControl: text("persons_of_control"),
  latestAccountsUrl: text("latest_accounts_url"),
  latestAccountsType: text("latest_accounts_type"),
  hasInsolvencyHistory: boolean("has_insolvency_history"),
  hasCharges: boolean("has_charges"),
  chargesCount: integer("charges_count"),
  fetchedAt: text("fetched_at").notNull(),
});

// Marketing signals
export const marketingSignals = pgTable("marketing_signals", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  hasMetaAds: boolean("has_meta_ads"),
  metaAdCount: integer("meta_ad_count"),
  metaAdLastSeen: text("meta_ad_last_seen"),
  hasGoogleAnalytics: boolean("has_google_analytics"),
  hasGoogleAds: boolean("has_google_ads"),
  hasMetaPixel: boolean("has_meta_pixel"),
  hasCrmTool: boolean("has_crm_tool"),
  crmToolName: text("crm_tool_name"),
  hasLiveChat: boolean("has_live_chat"),
  liveChatTool: text("live_chat_tool"),
  detectedTechnologies: text("detected_technologies"),
  estimatedMonthlyTraffic: integer("estimated_monthly_traffic"),
  estimatedAdSpend: real("estimated_ad_spend"),
  // Social media profile URLs (extracted from website HTML)
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  youtubeUrl: text("youtube_url"),
  detectionVersion: integer("detection_version").default(3),
  fetchedAt: text("fetched_at").notNull(),
});

// SEO/backlinks data
export const seoData = pgTable("seo_data", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  domainAuthority: integer("domain_authority"),
  backlinksCount: integer("backlinks_count"),
  referringDomains: integer("referring_domains"),
  organicKeywords: integer("organic_keywords"),
  fetchedAt: text("fetched_at").notNull(),
});

// Traffic estimation data
export const trafficData = pgTable("traffic_data", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  googleOrganicEtv: real("google_organic_etv"),
  googleOrganicCount: integer("google_organic_count"),
  googleOrganicTrafficCost: real("google_organic_traffic_cost"),
  googlePaidEtv: real("google_paid_etv"),
  googlePaidCount: integer("google_paid_count"),
  googlePaidTrafficCost: real("google_paid_traffic_cost"),
  googleFeaturedSnippetEtv: real("google_featured_snippet_etv"),
  googleLocalPackEtv: real("google_local_pack_etv"),
  googleOrganicPos1: integer("google_organic_pos_1"),
  googleOrganicPos2_3: integer("google_organic_pos_2_3"),
  googleOrganicPos4_10: integer("google_organic_pos_4_10"),
  googleOrganicPos11_20: integer("google_organic_pos_11_20"),
  googleOrganicIsNew: integer("google_organic_is_new"),
  googleOrganicIsUp: integer("google_organic_is_up"),
  googleOrganicIsDown: integer("google_organic_is_down"),
  googleOrganicIsLost: integer("google_organic_is_lost"),
  googlePaidPos1: integer("google_paid_pos_1"),
  googlePaidPos2_3: integer("google_paid_pos_2_3"),
  googlePaidPos4_10: integer("google_paid_pos_4_10"),
  bingOrganicEtv: real("bing_organic_etv"),
  bingOrganicCount: integer("bing_organic_count"),
  bingPaidEtv: real("bing_paid_etv"),
  bingPaidCount: integer("bing_paid_count"),
  source: text("source"),
  fetchedAt: text("fetched_at").notNull(),
});

// Keywords for site data
export const keywordData = pgTable("keyword_data", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  keyword: text("keyword").notNull(),
  searchVolume: integer("search_volume"),
  cpc: real("cpc"),
  competition: text("competition"),
  competitionIndex: integer("competition_index"),
  lowTopOfPageBid: real("low_top_of_page_bid"),
  highTopOfPageBid: real("high_top_of_page_bid"),
  monthlySearches: text("monthly_searches"),
  fetchedAt: text("fetched_at").notNull(),
});

// Computed scores
export const installerScores = pgTable("installer_scores", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  reputationScore: real("reputation_score"),
  marketingActivityScore: real("marketing_activity_score"),
  overallScore: real("overall_score"),
  tier: text("tier"),
  lastCalculatedAt: text("last_calculated_at").notNull(),
});

// Enrichment job tracking
export const enrichmentJobs = pgTable("enrichment_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  totalItems: integer("total_items"),
  processedItems: integer("processed_items"),
  errorCount: integer("error_count"),
  errorLog: text("error_log"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Google My Business Info
export const googleBusinessInfo = pgTable("google_business_info", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  placeId: text("place_id"),
  title: text("title"),
  phone: text("phone"),
  website: text("website_domain"),
  mainCategory: text("main_category"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  totalPhotos: integer("total_photos"),
  isClaimed: boolean("is_claimed"),
  currentStatus: text("current_status"), // "opened", "closed", "temporarily_closed"
  workHours: text("work_hours"), // JSON
  priceLevel: text("price_level"),
  additionalCategories: text("additional_categories"), // JSON array
  fetchedAt: text("fetched_at").notNull(),
});

// Google Ads Transparency data
export const googleAdsData = pgTable("google_ads_data", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  advertiserId: text("advertiser_id"),
  advertiserName: text("advertiser_name"),
  isVerified: boolean("is_verified"),
  totalAds: integer("total_ads"),
  textAds: integer("text_ads"),
  imageAds: integer("image_ads"),
  videoAds: integer("video_ads"),
  platforms: text("platforms"), // JSON array of platforms where ads run
  firstAdSeen: text("first_ad_seen"),
  lastAdSeen: text("last_ad_seen"),
  sampleAdTitles: text("sample_ad_titles"), // JSON array of ad titles
  transparencyUrls: text("transparency_urls"), // JSON array of links to ads on Google Transparency Center
  fetchedAt: text("fetched_at").notNull(),
});

// Job postings detection
export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  totalPostings: integer("total_postings"),
  postings: text("postings"), // JSON array of { title, location, source, url, datePosted }
  isHiring: boolean("is_hiring"),
  fetchedAt: text("fetched_at").notNull(),
});

// Website quality / PageSpeed data
export const websiteQuality = pgTable("website_quality", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  // PageSpeed Insights scores (0-100)
  performanceScore: integer("performance_score"),
  accessibilityScore: integer("accessibility_score"),
  bestPracticesScore: integer("best_practices_score"),
  seoScore: integer("seo_score"),
  // Form quality
  formType: text("form_type"), // "none" | "basic_contact" | "quote_form" | "multi_step"
  formDetails: text("form_details"), // JSON: detected fields, step indicators, etc.
  // Website signals
  siteBuilder: text("site_builder"), // "wordpress" | "wix" | "squarespace" | "custom" | etc.
  hasSocialLinks: boolean("has_social_links"),
  hasFavicon: boolean("has_favicon"),
  isMobileResponsive: boolean("is_mobile_responsive"),
  hasPrivacyPolicy: boolean("has_privacy_policy"),
  hasCookieConsent: boolean("has_cookie_consent"),
  copyrightYear: integer("copyright_year"),
  hasSchemaMarkup: boolean("has_schema_markup"),
  hasBlog: boolean("has_blog"),
  wordpressVersion: text("wordpress_version"),
  brokenImageCount: integer("broken_image_count"),
  imageCount: integer("image_count"),
  hasGenericEmail: boolean("has_generic_email"),
  agencyName: text("agency_name"),
  responseTimeMs: integer("response_time_ms"),
  isHttps: boolean("is_https"),
  enrichmentVersion: integer("enrichment_version"),
  fetchedAt: text("fetched_at").notNull(),
});

// CRM activities
export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  type: text("type").notNull(),
  content: text("content").notNull(),
  metadata: text("metadata"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const installerNotes = activities;

// LinkedIn company tracking (for Apify post search filtering)
export const linkedinCompanyTracking = pgTable("linkedin_company_tracking", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .unique()
    .references(() => installers.id),
  linkedinUrl: text("linkedin_url").notNull(), // e.g. https://linkedin.com/company/acme
  companySlug: text("company_slug"), // e.g. "acme" — extracted from URL
  lastSearchedAt: text("last_searched_at"), // null until first keyword search
  lastScrapedPostsAt: text("last_scraped_posts_at"), // null until first full post scrape
  lastScrapedEmployeesAt: text("last_scraped_employees_at"), // null until first employee scrape
});

// LinkedIn contacts — auto-populated from post search results
export const linkedinContacts = pgTable("linkedin_contacts", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  linkedinUrn: text("linkedin_urn"), // numeric member ID e.g. "459825050"
  publicIdentifier: text("public_identifier"), // e.g. "benjamin-whitla-562bb2109"
  profileUrl: text("profile_url"),
  name: text("name").notNull(),
  headline: text("headline"), // job title / info from LinkedIn
  jobTitle: text("job_title"), // from currentPositions[0].title
  avatarUrl: text("avatar_url"),
  location: text("location"), // e.g. "Clitheroe, England, United Kingdom"
  openProfile: boolean("open_profile"), // whether profile is open to messages
  premium: boolean("premium"), // LinkedIn Premium subscriber
  currentPositions: text("current_positions"), // JSON array of positions with tenure, description
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (t) => [unique("uq_linkedin_contact").on(t.installerId, t.linkedinUrn)]);

// Social signals from LinkedIn (posts by employees of tracked companies)
export const socialSignals = pgTable("social_signals", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  contactId: integer("contact_id")
    .references(() => linkedinContacts.id),
  postId: text("post_id").notNull().unique(), // LinkedIn post ID — dedupe key
  postUrl: text("post_url"),
  postText: text("post_text"),
  authorName: text("author_name"),
  authorHeadline: text("author_headline"), // info field — contains job title + company
  authorProfileUrl: text("author_profile_url"),
  authorProfileId: text("author_profile_id"), // LinkedIn public identifier
  postedAt: text("posted_at"), // ISO timestamp of the post
  postedAtTimestamp: integer("posted_at_timestamp"), // Unix timestamp
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  reactions: text("reactions"), // JSON: [{ type: "LIKE", count: 34 }, ...]
  postImages: text("post_images"), // JSON: [{ url, width, height }]
  postVideo: text("post_video"), // JSON: { thumbnailUrl, videoUrl }
  articleTitle: text("article_title"),
  articleLink: text("article_link"),
  matchedKeyword: text("matched_keyword"), // which search keyword found this post
  relevanceScore: integer("relevance_score"), // 0-100 from AI analysis
  relevanceReason: text("relevance_reason"), // AI explanation of why this post is relevant
  status: text("status").default("new"), // "new" | "dismissed" | "actioned"
  signalType: text("signal_type").notNull(), // "post" | "repost"
  fetchedAt: text("fetched_at").notNull(),
  generatedLinkedinMsg: text("generated_linkedin_msg"),
  generatedEmailMsg: text("generated_email_msg"),
});

// Outreach messages — tracks drafted/sent messages to installer contacts
export const outreachMessages = pgTable("outreach_messages", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  signalId: integer("signal_id")
    .references(() => socialSignals.id),
  contactName: text("contact_name").notNull(),
  contactLinkedinUrl: text("contact_linkedin_url"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  platform: text("platform").notNull(), // "linkedin" | "email" | "call"
  message: text("message").notNull(),
  status: text("status").notNull().default("draft"), // "draft" | "approved" | "sent"
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// App-wide settings (shared across all sessions)
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// DataForSEO async task tracking
export const dataforseoTasks = pgTable("dataforseo_tasks", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  taskId: text("task_id").notNull(),
  source: text("source").notNull(),
  endpoint: text("endpoint").notNull(),
  status: text("status").notNull().default("pending"),
  searchTerm: text("search_term"),
  resultSummary: text("result_summary"),
  rawResult: text("raw_result"), // Full API response JSON for re-processing
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  completedAt: text("completed_at"),
});

// Tags
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
});

export const installerTags = pgTable("installer_tags", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id),
});

// Source tracking junction table
export const installerSources = pgTable(
  "installer_sources",
  {
    id: serial("id").primaryKey(),
    installerId: integer("installer_id")
      .notNull()
      .references(() => installers.id),
    source: text("source").notNull(), // "mcs" | "enf" | "trustmark"
    sourceIdentifier: text("source_identifier").notNull(),
    sourceCompanyName: text("source_company_name"),
    sourcePostcode: text("source_postcode"),
    importedAt: text("imported_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [unique("uq_source_identifier").on(t.source, t.sourceIdentifier)]
);

// Mystery Shopping — campaign container
export const mysteryShopCampaigns = pgTable("mystery_shop_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | running | completed | cancelled
  zones: text("zones"), // JSON array of zone IDs, null = all zones
  systemSpec: text("system_spec"), // e.g. "10 panel system with battery"
  propertyConfig: text("property_config"), // JSON — flexible property details for this campaign
  totalTargets: integer("total_targets").default(0),
  processedTargets: integer("processed_targets").default(0),
  errorCount: integer("error_count").default(0),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Mystery Shopping — reference property per zone
export const mysteryShopZoneProperties = pgTable("mystery_shop_zone_properties", {
  id: serial("id").primaryKey(),
  zoneId: text("zone_id").notNull().unique(), // matches UK_ZONES[n].id
  address: text("address").notNull(),
  postcode: text("postcode").notNull(),
  details: text("details"), // JSON — flexible: propertyType, bedrooms, roofOrientation, roofType, annualUsage, electricityBill, etc.
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Mystery Shopping — individual installer target within a campaign
export const mysteryShopTargets = pgTable("mystery_shop_targets", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => mysteryShopCampaigns.id),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  category: text("category").notNull(), // calculator | web_form | email_outreach
  status: text("status").notNull().default("pending"), // pending | submitting | submitted | response_received | parsed | failed | no_response
  burnerEmail: text("burner_email"), // plus-address alias used for this target
  submittedAt: text("submitted_at"),
  firstResponseAt: text("first_response_at"),
  responseTimeHours: real("response_time_hours"),
  responseFormat: text("response_format"), // pdf | email_text | phone_callback | web_calculator | online_portal
  formData: text("form_data"), // JSON — questions asked & answers given (varies per installer)
  rawResponseData: text("raw_response_data"), // JSON — raw email body, scraped output, screenshot URLs
  aiParseStatus: text("ai_parse_status"), // pending | parsed | failed
  errorLog: text("error_log"), // JSON array of error strings
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (t) => [unique("uq_campaign_installer").on(t.campaignId, t.installerId)]);

// Mystery Shopping — parsed quote data (one target can have multiple options)
export const mysteryShopQuotes = pgTable("mystery_shop_quotes", {
  id: serial("id").primaryKey(),
  targetId: integer("target_id")
    .notNull()
    .references(() => mysteryShopTargets.id),
  optionLabel: text("option_label"), // e.g. "Standard", "Premium", "Option A"
  totalPrice: real("total_price"), // GBP — the key queryable field
  summary: text("summary"), // human-readable one-liner
  details: text("details"), // JSON — flexible structured breakdown (panels, battery, inverter, installation, vat, extras, warranty, etc.)
  rawAiOutput: text("raw_ai_output"), // JSON — full Gemini extraction for audit
  confidence: real("confidence"), // 0-1
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Price Tracker — stores results from each automated price scrape
export const priceScrapeResults = pgTable("price_scrape_results", {
  id: serial("id").primaryKey(),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  postcode: text("postcode").notNull(), // postcode used for this scrape
  propertyConfig: text("property_config"), // JSON — property details used (roof type, usage, etc.)
  // Key queryable fields
  panelOnlyPrice: real("panel_only_price"), // panels without battery
  recommendedPrice: real("recommended_price"), // default recommended config price
  pricePerPanel: real("price_per_panel"),
  recommendedPanelCount: integer("recommended_panel_count"),
  panelModel: text("panel_model"),
  // Full price matrix as JSON (panel price points, all battery options, extras)
  priceMatrix: text("price_matrix"), // JSON — the complete BoxtPriceMatrix or equivalent
  screenshotPath: text("screenshot_path"),
  errorLog: text("error_log"),
  scrapedAt: text("scraped_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Competitors — marketing agencies and their installer clients
export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  linkedinUrl: text("linkedin_url"),
  linkedinSlug: text("linkedin_slug"), // e.g. "we-build-trades" from the URL
  notes: text("notes"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const competitorClients = pgTable("competitor_clients", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id")
    .notNull()
    .references(() => competitors.id),
  installerId: integer("installer_id")
    .notNull()
    .references(() => installers.id),
  source: text("source").default("manual"), // manual | linkedin_engagement
  confidence: real("confidence"), // 0-1 for auto-detected clients
  notes: text("notes"),
  addedAt: text("added_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Competitor employees scraped from LinkedIn
export const competitorEmployees = pgTable("competitor_employees", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id")
    .notNull()
    .references(() => competitors.id),
  fullName: text("full_name").notNull(),
  headline: text("headline"),
  profileUrl: text("profile_url"),
  avatarUrl: text("avatar_url"),
  role: text("role"), // parsed from headline
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Posts by competitor company or employees
export const competitorPosts = pgTable("competitor_posts", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id")
    .notNull()
    .references(() => competitors.id),
  employeeId: integer("employee_id")
    .references(() => competitorEmployees.id),
  postUrl: text("post_url"),
  postId: text("post_id").unique(),
  authorName: text("author_name"),
  postText: text("post_text"),
  postedAt: text("posted_at"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  scrapedAt: text("scraped_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Engagement on competitor posts — installers who react/comment
export const competitorPostEngagement = pgTable("competitor_post_engagement", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => competitorPosts.id),
  competitorId: integer("competitor_id")
    .notNull()
    .references(() => competitors.id),
  // The person who engaged
  engagerName: text("engager_name").notNull(),
  engagerHeadline: text("engager_headline"),
  engagerProfileUrl: text("engager_profile_url"),
  engagerCompany: text("engager_company"),
  // Matched installer (if we can match to our DB)
  installerId: integer("installer_id")
    .references(() => installers.id),
  engagementType: text("engagement_type").notNull(), // like | comment | repost
  commentText: text("comment_text"),
  scrapedAt: text("scraped_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Mystery Shopping — email personas for outreach
export const mysteryShopEmailAccounts = pgTable("mystery_shop_email_accounts", {
  id: serial("id").primaryKey(),
  emailAddress: text("email_address").notNull().unique(),
  displayName: text("display_name").notNull(),
  phoneNumber: text("phone_number"),
  zoneId: text("zone_id"),
  isActive: boolean("is_active").default(true),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
