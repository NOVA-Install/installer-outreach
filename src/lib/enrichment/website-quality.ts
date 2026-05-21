import { db } from "@/lib/db";
import {
  installers,
  websiteQuality,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

// --- Form quality detection from HTML ---

const MULTI_STEP_SIGNALS = [
  "data-step", "data-steps", "step-indicator", "progress-bar", "progressbar",
  "wizard", "multi-step", "multistep", "form-step", "formstep",
  "step 1", "step 2", "step-1", "step-2", "stepper",
  "next-step", "nextstep", "previous-step",
];

const QUOTE_TOOL_EMBEDS = [
  "solarhero", "solar-hero", "genous", "sunstak", "opensolar",
  "easysolar", "typeform.com", "jotform.com",
  "calendly.com", "hubspot.com/meetings",
];

const QUOTE_KEYWORDS = [
  "get a quote", "get your quote", "free quote", "request a quote",
  "solar calculator", "energy calculator", "savings calculator",
  "roof type", "roof orientation", "energy usage", "electricity bill",
  "property type", "how many bedrooms", "annual usage",
];

const BASIC_FORM_SIGNALS = [
  "contact us", "contact form", "get in touch", "send us a message",
  "send message", "enquiry form", "inquiry form",
];

export function detectFormQuality(html: string): {
  formType: "none" | "basic_contact" | "quote_form" | "multi_step";
  details: Record<string, unknown>;
} {
  const lower = html.toLowerCase();

  // Count form elements
  const formCount = (lower.match(/<form[\s>]/g) || []).length;
  const inputCount = (lower.match(/<input[\s>]/g) || []).length;
  const textareaCount = (lower.match(/<textarea[\s>]/g) || []).length;
  const selectCount = (lower.match(/<select[\s>]/g) || []).length;
  const fieldsetCount = (lower.match(/<fieldset[\s>]/g) || []).length;

  // Check for known quote tool embeds (iframe or script)
  const hasQuoteEmbed = QUOTE_TOOL_EMBEDS.some((t) => lower.includes(t));

  // Check for multi-step signals
  const multiStepHits = MULTI_STEP_SIGNALS.filter((s) => lower.includes(s));
  const hasMultiStep = multiStepHits.length >= 1;

  // Check for quote-specific keywords
  const quoteKeywordHits = QUOTE_KEYWORDS.filter((k) => lower.includes(k));
  const hasQuoteKeywords = quoteKeywordHits.length >= 1;

  // Check for basic contact form signals
  const hasBasicFormSignals = BASIC_FORM_SIGNALS.some((s) => lower.includes(s));

  const details: Record<string, unknown> = {
    formCount,
    inputCount,
    textareaCount,
    selectCount,
    fieldsetCount,
    multiStepHits,
    quoteKeywordHits,
    hasQuoteEmbed,
  };

  // Classification logic
  if (hasQuoteEmbed || hasMultiStep) {
    return { formType: "multi_step", details };
  }

  if (hasQuoteKeywords && (inputCount > 6 || fieldsetCount > 1 || selectCount > 1)) {
    return { formType: "multi_step", details };
  }

  if (hasQuoteKeywords) {
    return { formType: "quote_form", details };
  }

  if (formCount > 0 || hasBasicFormSignals) {
    return { formType: "basic_contact", details };
  }

  return { formType: "none", details };
}

// --- HTML-based website quality signals ---

export interface WebsiteSignals {
  siteBuilder: string | null;
  hasSocialLinks: boolean;
  hasFavicon: boolean;
  isMobileResponsive: boolean;
  hasPrivacyPolicy: boolean;
  hasCookieConsent: boolean;
  copyrightYear: number | null;
  hasSchemaMarkup: boolean;
  hasBlog: boolean;
  wordpressVersion: string | null;
  brokenImageCount: number;
  imageCount: number;
  hasGenericEmail: boolean;
}

export function detectWebsiteSignals(html: string, email?: string | null): WebsiteSignals {
  const lower = html.toLowerCase();

  // Site builder
  let siteBuilder: string | null = null;
  if (lower.includes("wp-content") || lower.includes("wp-includes") || lower.includes("wordpress")) siteBuilder = "WordPress";
  else if (lower.includes("wix.com") || lower.includes("wixsite.com") || lower.includes("x-wix")) siteBuilder = "Wix";
  else if (lower.includes("squarespace.com") || lower.includes("sqsp.net") || lower.includes("squarespace-cdn")) siteBuilder = "Squarespace";
  else if (lower.includes("shopify.com") || lower.includes("myshopify.com") || lower.includes("cdn.shopify")) siteBuilder = "Shopify";
  else if (lower.includes("webflow.com") || lower.includes("webflow.io")) siteBuilder = "Webflow";
  else if (lower.includes("weebly.com")) siteBuilder = "Weebly";
  else if (lower.includes("godaddy.com/websites") || lower.includes("godaddysites.com")) siteBuilder = "GoDaddy";
  else if (lower.includes("duda.co") || lower.includes("dudaone.com")) siteBuilder = "Duda";

  // Social media links
  const hasSocialLinks = ["facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com/"].some((s) => lower.includes(s));

  // Favicon
  const hasFavicon = lower.includes('rel="icon"') || lower.includes("rel='icon'") || lower.includes("rel=\"shortcut icon\"") || lower.includes("rel='shortcut icon'");

  // Mobile responsive (viewport meta tag)
  const isMobileResponsive = lower.includes('name="viewport"') || lower.includes("name='viewport'");

  // Privacy policy
  const hasPrivacyPolicy = lower.includes("privacy policy") || lower.includes("privacy-policy") || lower.includes("/privacy");

  // Cookie consent
  const hasCookieConsent = ["cookiebot", "onetrust", "cookie-consent", "cookie_consent", "cookieconsent",
    "gdpr", "cookie-law", "cookie-notice", "cookie-banner", "cc-banner", "cc-window"].some((s) => lower.includes(s));

  // Copyright year
  let copyrightYear: number | null = null;
  const yearMatch = html.match(/©\s*(\d{4})|&copy;\s*(\d{4})|copyright\s*(\d{4})/i);
  if (yearMatch) {
    const year = parseInt(yearMatch[1] || yearMatch[2] || yearMatch[3]);
    if (year >= 2000 && year <= 2030) copyrightYear = year;
  }

  // Schema markup
  const hasSchemaMarkup = lower.includes('type="application/ld+json"') || lower.includes("type='application/ld+json'");

  // Blog detection
  const hasBlog = ["/blog", "/news", "/articles", "/insights", "/resources"].some((p) => lower.includes(`href="${p}`) || lower.includes(`href='${p}`));

  // WordPress version
  let wordpressVersion: string | null = null;
  if (siteBuilder === "WordPress") {
    const wpVerMatch = html.match(/ver=(\d+\.\d+(?:\.\d+)?)/);
    if (wpVerMatch) wordpressVersion = wpVerMatch[1];
    // Also check meta generator tag
    const genMatch = html.match(/content="WordPress\s+([\d.]+)"/i);
    if (genMatch) wordpressVersion = genMatch[1];
  }

  // Image count (for broken image detection — actual broken check needs fetch)
  const imgMatches = html.match(/<img\s[^>]*src\s*=\s*["'][^"']+["']/gi) || [];
  const imageCount = imgMatches.length;
  // We can detect obviously broken images: empty src, data: with no content, etc.
  const brokenImageCount = imgMatches.filter((img) => {
    const srcMatch = img.match(/src\s*=\s*["']([^"']*?)["']/i);
    if (!srcMatch) return true;
    const src = srcMatch[1];
    return !src || src === "#" || src === "about:blank";
  }).length;

  // Generic email detection
  const genericDomains = ["gmail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com", "aol.com", "live.com", "icloud.com", "mail.com", "btinternet.com", "sky.com", "virginmedia.com"];
  const hasGenericEmail = email ? genericDomains.some((d) => email.toLowerCase().endsWith(`@${d}`)) : false;

  return { siteBuilder, hasSocialLinks, hasFavicon, isMobileResponsive, hasPrivacyPolicy, hasCookieConsent, copyrightYear, hasSchemaMarkup, hasBlog, wordpressVersion, brokenImageCount, imageCount, hasGenericEmail };
}

// --- PageSpeed Insights API ---

interface PageSpeedResult {
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
}

async function fetchPageSpeed(url: string): Promise<PageSpeedResult> {
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=performance&category=accessibility&category=best-practices&category=seo&strategy=mobile`;
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });
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

// --- Batch enrichment ---

export async function enrichWebsiteQuality(
  jobId: number,
  installerIds?: number[]
) {
  const query = installerIds
    ? db
        .select({ id: installers.id, website: installers.website, email: installers.email })
        .from(installers)
        .where(
          sql`${installers.id} IN (${sql.join(
            installerIds.map((id) => sql`${id}`),
            sql`,`
          )}) AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`
        )
    : db
        .select({ id: installers.id, website: installers.website, email: installers.email })
        .from(installers)
        .leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId))
        .where(
          sql`${websiteQuality.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`
        );

  const toEnrich = await query;

  await db
    .update(enrichmentJobs)
    .set({
      totalItems: toEnrich.length,
      processedItems: 0,
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .where(eq(enrichmentJobs.id, jobId));

  let processed = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Process in batches of 5 (PageSpeed API is rate-limited ~25 req/min)
  for (let i = 0; i < toEnrich.length; i += 5) {
    const [currentJob] = await db
      .select({ status: enrichmentJobs.status })
      .from(enrichmentJobs)
      .where(eq(enrichmentJobs.id, jobId))
      .limit(1);
    if (currentJob?.status === "cancelled") break;

    const batch = toEnrich.slice(i, i + 5).filter((inst) => inst.website);

    const results = await Promise.allSettled(
      batch.map(async (installer) => {
        const url = installer.website!.startsWith("http")
          ? installer.website!
          : `https://${installer.website}`;

        // Fetch HTML for form/signal detection + PageSpeed in parallel
        const [htmlResult, pageSpeedResult] = await Promise.allSettled([
          (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const start = Date.now();
            const res = await fetch(url, {
              signal: controller.signal,
              headers: { "User-Agent": "Mozilla/5.0 (compatible; InstallerCRM/1.0)" },
              redirect: "follow",
            });
            clearTimeout(timeout);
            const html = await res.text();
            const responseTimeMs = Date.now() - start;
            const isHttps = res.url.startsWith("https://");
            return { html, responseTimeMs, isHttps };
          })(),
          fetchPageSpeed(url),
        ]);

        const htmlData = htmlResult.status === "fulfilled" ? htmlResult.value : null;
        const pageSpeed = pageSpeedResult.status === "fulfilled" ? pageSpeedResult.value : null;

        const form = htmlData ? detectFormQuality(htmlData.html) : { formType: "none" as const, details: {} };
        const signals = htmlData ? detectWebsiteSignals(htmlData.html, installer.email) : null;

        await db.insert(websiteQuality).values({
          installerId: installer.id,
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
          responseTimeMs: htmlData?.responseTimeMs ?? null,
          isHttps: htmlData?.isHttps ?? null,
          fetchedAt: new Date().toISOString(),
        });
      })
    );

    for (const r of results) {
      processed++;
      if (r.status === "rejected") {
        errors++;
        errorLog.push(r.reason?.message || String(r.reason));
      }
    }

    await db
      .update(enrichmentJobs)
      .set({ processedItems: processed, errorCount: errors })
      .where(eq(enrichmentJobs.id, jobId));
  }

  await db
    .update(enrichmentJobs)
    .set({
      status: "completed",
      processedItems: processed,
      errorCount: errors,
      errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
      completedAt: new Date().toISOString(),
    })
    .where(eq(enrichmentJobs.id, jobId));
}

// --- Single installer enrichment ---

export async function enrichSingleWebsiteQuality(installerId: number, website: string, email?: string | null) {
  const url = website.startsWith("http") ? website : `https://${website}`;

  const [htmlResult, pageSpeedResult] = await Promise.allSettled([
    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const start = Date.now();
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InstallerCRM/1.0)" },
        redirect: "follow",
      });
      clearTimeout(timeout);
      const html = await res.text();
      return { html, responseTimeMs: Date.now() - start, isHttps: res.url.startsWith("https://") };
    })(),
    fetchPageSpeed(url),
  ]);

  const htmlData = htmlResult.status === "fulfilled" ? htmlResult.value : null;
  const pageSpeed = pageSpeedResult.status === "fulfilled" ? pageSpeedResult.value : null;

  const form = htmlData ? detectFormQuality(htmlData.html) : { formType: "none" as const, details: {} };
  const signals = htmlData ? detectWebsiteSignals(htmlData.html, email) : null;

  await db.delete(websiteQuality).where(eq(websiteQuality.installerId, installerId));

  await db.insert(websiteQuality).values({
    installerId,
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
    responseTimeMs: htmlData?.responseTimeMs ?? null,
    isHttps: htmlData?.isHttps ?? null,
    fetchedAt: new Date().toISOString(),
  });

  return {
    pageSpeed,
    formType: form.formType,
    formDetails: form.details,
    signals,
    responseTimeMs: htmlData?.responseTimeMs ?? null,
  };
}
