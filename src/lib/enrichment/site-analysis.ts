import { db } from "@/lib/db";
import { installers, marketingSignals, websiteQuality } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { robustFetch } from "./fetch-utils";
import { detectFormQuality, detectWebsiteSignals, detectAgency } from "./website-quality";

// Bump when detection logic changes — batch runs re-enrich outdated rows
export const SITE_ANALYSIS_VERSION = 1;

// ─── Tech detection patterns (from HTML) ───

const TECH_PATTERNS: { name: string; field: string; patterns: string[] }[] = [
  { name: "Google Analytics", field: "ga", patterns: ["gtag(", "google-analytics.com", "googletagmanager.com", "analytics.js", "ga.js"] },
  { name: "Google Ads", field: "gads", patterns: ["aw-", "googleadservices.com", "google_conversion", "conversion.js", "googleads.g.doubleclick.net", "googlesyndication.com", "adservice.google.com", "ads/ga-audiences"] },
  { name: "Microsoft Ads", field: "tech", patterns: ["bat.bing.com", "uetag", "uet tag", "clarity.ms", "microsoft.com/muid"] },
  { name: "Meta Pixel", field: "meta", patterns: ["fbq(", "connect.facebook.net", "facebook-jssdk", "facebook.com/tr"] },
  { name: "HubSpot", field: "crm", patterns: ["hs-scripts.com", "hubspot.com", "hbspt.forms", "hs-analytics"] },
  { name: "Salesforce", field: "crm", patterns: ["pardot.com", "salesforce.com", "force.com"] },
  { name: "Zoho", field: "crm", patterns: ["zoho.com", "zohocdn.com", "salesiq.zoho"] },
  { name: "Pipedrive", field: "crm", patterns: ["pipedrive.com", "pipedrivewebforms"] },
  { name: "ActiveCampaign", field: "crm", patterns: ["activecampaign.com", "trackcmp.net"] },
  { name: "Keap", field: "crm", patterns: ["keap.com", "infusionsoft.com", "keap.app"] },
  { name: "Monday.com", field: "crm", patterns: ["monday.com"] },
  { name: "Freshsales", field: "crm", patterns: ["freshsales.io", "freshworks.com"] },
  { name: "Simplified Energy", field: "crm", patterns: ["simplifiedenergy.co", "simplified.energy", "simplifiedenergy.com"] },
  { name: "Autarc", field: "crm", patterns: ["autarc.energy"] },
  { name: "Reonic", field: "crm", patterns: ["reonic.de", "reonic.com", "app.reonic"] },
  { name: "SolarEdge", field: "crm", patterns: ["solaredge.com", "monitoring.solaredge.com"] },
  { name: "Enphase", field: "crm", patterns: ["enphase.com", "enlighten.enphaseenergy.com"] },
  { name: "EasySolar", field: "crm", patterns: ["easysolar.com", "easysolar.io"] },
  { name: "Pylon", field: "crm", patterns: ["pylon.energy", "pylon-network.org"] },
  { name: "OpenSolar", field: "crm", patterns: ["opensolar.com", "app.opensolar"] },
  { name: "Sunstak", field: "crm", patterns: ["sunstak.com", "sunstak.co.uk"] },
  { name: "JobNimbus", field: "crm", patterns: ["jobnimbus.com", "app.jobnimbus.com"] },
  { name: "Commusoft", field: "crm", patterns: ["commusoft.co.uk", "commusoft.com"] },
  { name: "SimPRO", field: "crm", patterns: ["simpro.co", "simprogroup.com"] },
  { name: "Tradify", field: "crm", patterns: ["tradifyhq.com", "tradify.com"] },
  { name: "Tawk.to", field: "chat", patterns: ["tawk.to", "embed.tawk.to"] },
  { name: "Intercom", field: "chat", patterns: ["intercom.io", "intercomcdn.com", "widget.intercom.io"] },
  { name: "Drift", field: "chat", patterns: ["drift.com", "js.driftt.com"] },
  { name: "Crisp", field: "chat", patterns: ["crisp.chat", "client.crisp.chat"] },
  { name: "Zendesk", field: "chat", patterns: ["zdassets.com", "zendesk.com", "zopim.com"] },
  { name: "LiveChat", field: "chat", patterns: ["livechatinc.com", "livechat.com"] },
  { name: "Google Tag Manager", field: "tech", patterns: ["googletagmanager.com/gtm.js", "gtm-"] },
  { name: "Hotjar", field: "tech", patterns: ["hotjar.com", "static.hotjar.com"] },
  { name: "Mailchimp", field: "tech", patterns: ["mailchimp.com", "list-manage.com", "chimpstatic.com"] },
];

// ─── Social link extraction ───

const SOCIAL_PATTERNS: { key: string; regex: RegExp; exclude: RegExp }[] = [
  { key: "facebook_url", regex: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)['"]/gi, exclude: /facebook\.com\/(sharer|share|dialog|plugins|tr|hashtag|flx|watch|groups\/\d|pages\/category|login|help|policies)/i },
  { key: "instagram_url", regex: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)['"]/gi, exclude: /instagram\.com\/(explore|accounts|p\/|reel\/|stories\/|about|developer|legal)/i },
  { key: "linkedin_url", regex: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?)['"]/gi, exclude: /linkedin\.com\/(share|sharing|pulse|jobs|learning|feed)/i },
  { key: "twitter_url", regex: /href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?)['"]/gi, exclude: /(?:twitter|x)\.com\/(intent|share|hashtag|search|home|i\/|widgets)/i },
  { key: "youtube_url", regex: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)[a-zA-Z0-9._-]+\/?)['"]/gi, exclude: /youtube\.com\/(watch|embed|playlist|results|feed|shorts)/i },
];

function extractSocialLinks(html: string): Record<string, string | null> {
  const links: Record<string, string | null> = {
    facebook_url: null, instagram_url: null, linkedin_url: null, twitter_url: null, youtube_url: null,
  };
  for (const { key, regex, exclude } of SOCIAL_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (!exclude.test(match[1])) { links[key] = match[1]; break; }
    }
  }
  return links;
}

// ─── PageSpeed API ───

async function fetchPageSpeed(url: string) {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;
  const keyParam = apiKey ? `&key=${apiKey}` : "";
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=performance&category=accessibility&category=best-practices&category=seo&strategy=mobile${keyParam}`;
  const res = await robustFetch(apiUrl, {}, {
    timeoutMs: 60000,
    retries: 1,
    retryDelayMs: 2000,
    retryOn: (r) => r.status === 429 || r.status >= 500,
  });
  if (!res.ok) throw new Error(`PageSpeed API ${res.status}`);
  const json = await res.json();
  const cats = json.lighthouseResult?.categories || {};
  return {
    performanceScore: cats.performance?.score != null ? Math.round(cats.performance.score * 100) : null,
    accessibilityScore: cats.accessibility?.score != null ? Math.round(cats.accessibility.score * 100) : null,
    bestPracticesScore: cats["best-practices"]?.score != null ? Math.round(cats["best-practices"].score * 100) : null,
    seoScore: cats.seo?.score != null ? Math.round(cats.seo.score * 100) : null,
  };
}

// ─── Process a single installer ───

async function processInstaller(inst: { id: number; website: string; email: string | null }) {
  const url = inst.website.startsWith("http") ? inst.website : `https://${inst.website}`;

  // Fetch HTML + PageSpeed in parallel
  const [htmlResult, pageSpeedResult] = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      const res = await robustFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        redirect: "follow",
      }, { timeoutMs: 10000, retries: 1, retryDelayMs: 1000, retryOn: (r) => r.status >= 500 });
      const html = await res.text();
      return { html, responseTimeMs: Date.now() - start, isHttps: res.url.startsWith("https://") };
    })(),
    fetchPageSpeed(url),
  ]);

  const htmlData = htmlResult.status === "fulfilled" ? htmlResult.value : null;
  const pageSpeed = pageSpeedResult.status === "fulfilled" ? pageSpeedResult.value : null;

  // ── Tech detection (marketing_signals) ──
  const detected: string[] = [];
  let hasGA = false, hasGAds = false, hasMetaPixel = false;
  let hasCrm = false, crmName: string | null = null;
  let hasChat = false, chatName: string | null = null;
  const social: Record<string, string | null> = {
    facebook_url: null, instagram_url: null, linkedin_url: null, twitter_url: null, youtube_url: null,
  };

  if (htmlData) {
    const lower = htmlData.html.toLowerCase();
    for (const tech of TECH_PATTERNS) {
      if (tech.patterns.some((p) => lower.includes(p.toLowerCase()))) {
        detected.push(tech.name);
        if (tech.field === "ga") hasGA = true;
        if (tech.field === "gads") hasGAds = true;
        if (tech.field === "meta") hasMetaPixel = true;
        if (tech.field === "crm" && !hasCrm) { hasCrm = true; crmName = tech.name; }
        if (tech.field === "chat" && !hasChat) { hasChat = true; chatName = tech.name; }
      }
    }
    Object.assign(social, extractSocialLinks(htmlData.html));
  }

  if (!htmlData) detected.push("error:fetch_failed");

  const now = new Date().toISOString();

  await db.insert(marketingSignals).values({
    installerId: inst.id,
    hasGoogleAnalytics: hasGA,
    hasGoogleAds: hasGAds,
    hasMetaPixel: hasMetaPixel,
    hasCrmTool: hasCrm,
    crmToolName: crmName,
    hasLiveChat: hasChat,
    liveChatTool: chatName,
    detectedTechnologies: JSON.stringify(detected),
    facebookUrl: social.facebook_url,
    instagramUrl: social.instagram_url,
    linkedinUrl: social.linkedin_url,
    twitterUrl: social.twitter_url,
    youtubeUrl: social.youtube_url,
    detectionVersion: SITE_ANALYSIS_VERSION,
    fetchedAt: now,
  }).onConflictDoUpdate({
    target: marketingSignals.installerId,
    set: {
      hasGoogleAnalytics: hasGA,
      hasGoogleAds: hasGAds,
      hasMetaPixel: hasMetaPixel,
      hasCrmTool: hasCrm,
      crmToolName: crmName,
      hasLiveChat: hasChat,
      liveChatTool: chatName,
      detectedTechnologies: JSON.stringify(detected),
      facebookUrl: social.facebook_url,
      instagramUrl: social.instagram_url,
      linkedinUrl: social.linkedin_url,
      twitterUrl: social.twitter_url,
      youtubeUrl: social.youtube_url,
      detectionVersion: SITE_ANALYSIS_VERSION,
      fetchedAt: now,
    },
  });

  // ── Website quality (website_quality) ──
  const form = htmlData ? detectFormQuality(htmlData.html) : { formType: "none" as const, details: {} };
  const signals = htmlData ? detectWebsiteSignals(htmlData.html, inst.email) : null;
  const agencyName = htmlData ? detectAgency(htmlData.html) : null;

  const wqValues = {
    installerId: inst.id,
    performanceScore: pageSpeed?.performanceScore ?? null,
    accessibilityScore: pageSpeed?.accessibilityScore ?? null,
    bestPracticesScore: pageSpeed?.bestPracticesScore ?? null,
    seoScore: pageSpeed?.seoScore ?? null,
    formType: form.formType,
    formDetails: JSON.stringify(form.details),
    siteBuilder: signals?.siteBuilder ?? null,
    hasSocialLinks: signals?.hasSocialLinks ?? null,
    hasFavicon: signals?.hasFavicon ?? null,
    isMobileResponsive: signals?.isMobileResponsive ?? null,
    hasPrivacyPolicy: signals?.hasPrivacyPolicy ?? null,
    hasCookieConsent: signals?.hasCookieConsent ?? null,
    copyrightYear: signals?.copyrightYear ?? null,
    hasSchemaMarkup: signals?.hasSchemaMarkup ?? null,
    hasBlog: signals?.hasBlog ?? null,
    wordpressVersion: signals?.wordpressVersion ?? null,
    brokenImageCount: signals?.brokenImageCount ?? null,
    imageCount: signals?.imageCount ?? null,
    hasGenericEmail: signals?.hasGenericEmail ?? null,
    agencyName,
    responseTimeMs: htmlData?.responseTimeMs ?? null,
    isHttps: htmlData?.isHttps ?? null,
    enrichmentVersion: SITE_ANALYSIS_VERSION,
    fetchedAt: now,
  };
  await db.insert(websiteQuality).values(wqValues)
    .onConflictDoUpdate({ target: websiteQuality.installerId, set: wqValues });
}

// ─── Batch function (called per Inngest step) ───

export async function enrichSiteAnalysisBatch(batchSize = 20): Promise<{ processed: number; errors: number; remaining: number }> {
  // Find installers where either table is outdated
  const toEnrich = await db
    .select({ id: installers.id, website: installers.website, email: installers.email })
    .from(installers)
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId))
    .where(
      sql`${installers.website} IS NOT NULL AND ${installers.website} != '' AND (
        ${marketingSignals.detectionVersion} IS NULL OR ${marketingSignals.detectionVersion} < ${SITE_ANALYSIS_VERSION}
        OR ${websiteQuality.enrichmentVersion} IS NULL OR ${websiteQuality.enrichmentVersion} < ${SITE_ANALYSIS_VERSION}
      )`
    )
    .limit(batchSize + 1);

  const hasMore = toEnrich.length > batchSize;
  const batch = toEnrich.slice(0, batchSize).filter((inst) => inst.website);

  let processed = 0;
  let errors = 0;

  // Process in sub-batches of 5 (PageSpeed rate limit)
  for (let i = 0; i < batch.length; i += 5) {
    const chunk = batch.slice(i, i + 5);
    const results = await Promise.allSettled(
      chunk.map((inst) => processInstaller(inst as { id: number; website: string; email: string | null }))
    );
    for (const r of results) {
      processed++;
      if (r.status === "rejected") errors++;
    }
  }

  return { processed, errors, remaining: hasMore ? batchSize : 0 };
}
