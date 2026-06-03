/**
 * Crawl installer websites looking for visible pricing (no form required).
 * Checks homepage + common pricing URLs for £ amounts in solar range.
 *
 * Usage:
 *   npx tsx scripts/find-pricing-pages.ts              # run all (resumable)
 *   npx tsx scripts/find-pricing-pages.ts --limit 100  # test with first 100
 *   npx tsx scripts/find-pricing-pages.ts --report      # just show results from DB
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = postgres(DATABASE_URL, { prepare: false, max: 5 });

const REPORT_ONLY = process.argv.includes("--report");
const LIMIT = process.argv.includes("--limit")
  ? parseInt(process.argv[process.argv.indexOf("--limit") + 1], 10)
  : 0;

const CONCURRENCY = 10;
const TIMEOUT_MS = 10_000;

// Common pricing page paths to check
const PRICING_PATHS = [
  "/pricing", "/prices", "/price", "/price-list",
  "/solar-panel-prices", "/solar-panels/prices", "/solar-prices",
  "/costs", "/cost", "/packages", "/our-prices",
  "/solar-panel-costs", "/how-much", "/quote",
];

// Regex: find £ amounts between £500 and £99,999
const PRICE_REGEX = /£\s?(\d{1,2},?\d{3}(?:\.\d{2})?)/g;

// Context keywords that confirm it's real product pricing (not "save £X" or "from £X/month")
const PRICING_CONTEXT = /per panel|solar panel|battery|inverter|installation|system|package|kwp|kw system|panel system|bundle|total cost|installed|inc(?:luding)? vat|ex(?:cluding)? vat|price list|our prices|starting from|from £|prices start/i;

// Negative context — these suggest it's NOT a product price
const NEGATIVE_CONTEXT = /per month|monthly|save up to|saving|grant|bus grant|government|cashback|earn|feed.in|export|tariff|per year|annually|salary|£\d{1,3}(?:\.\d{2})?\s*(?:per|\/)\s*(?:month|week|hour|yr|year)/i;

function normalizeUrl(website: string): string {
  let url = website.trim();
  if (!url.startsWith("http")) url = `https://${url}`;
  // Remove trailing slash for consistency
  return url.replace(/\/+$/, "");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;/g, "£")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function extractPricingFromHtml(html: string, url: string): { prices: { amount: string; context: string }[]; pricingLinks: string[] } {
  const text = stripHtml(html);
  const prices: { amount: string; context: string }[] = [];

  // Find all £ amounts
  let match;
  const priceRegex = new RegExp(PRICE_REGEX.source, "g");
  while ((match = priceRegex.exec(text)) !== null) {
    const amount = match[0];
    const numericStr = match[1].replace(",", "");
    const numeric = parseFloat(numericStr);

    // Filter to solar pricing range: £500 - £50,000
    if (numeric < 500 || numeric > 50000) continue;

    // Get surrounding context (100 chars each side)
    const start = Math.max(0, match.index - 100);
    const end = Math.min(text.length, match.index + match[0].length + 100);
    const context = text.slice(start, end).trim();

    // Check for positive pricing context
    if (!PRICING_CONTEXT.test(context)) continue;

    // Skip if negative context dominates
    if (NEGATIVE_CONTEXT.test(context) && !context.match(/from £|starting|price|cost|package|system/i)) continue;

    prices.push({ amount, context });
  }

  // Find links to pricing pages
  const pricingLinks: string[] = [];
  const linkRegex = /href=["']([^"']*(?:pric|cost|package|quote|how-much|tariff)[^"']*)["']/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    pricingLinks.push(href);
  }

  return { prices, pricingLinks };
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function checkInstaller(installer: { id: number; company_name: string; website: string }): Promise<{
  id: number;
  companyName: string;
  website: string;
  hasPricing: boolean;
  prices: { amount: string; context: string }[];
  pricingPageUrl: string | null;
  checkedPages: number;
}> {
  const baseUrl = normalizeUrl(installer.website);
  let allPrices: { amount: string; context: string }[] = [];
  let pricingPageUrl: string | null = null;
  let checkedPages = 0;

  // 1. Check homepage
  const homepageHtml = await fetchWithTimeout(baseUrl);
  checkedPages++;
  if (homepageHtml) {
    const result = extractPricingFromHtml(homepageHtml, baseUrl);
    if (result.prices.length > 0) {
      allPrices.push(...result.prices);
      pricingPageUrl = baseUrl;
    }

    // 2. Check any pricing links found on homepage
    for (const link of result.pricingLinks.slice(0, 3)) {
      let fullUrl: string;
      try {
        fullUrl = new URL(link, baseUrl).href;
      } catch { continue; }

      // Only follow links on the same domain
      try {
        if (new URL(fullUrl).hostname !== new URL(baseUrl).hostname) continue;
      } catch { continue; }

      const pageHtml = await fetchWithTimeout(fullUrl);
      checkedPages++;
      if (pageHtml) {
        const pageResult = extractPricingFromHtml(pageHtml, fullUrl);
        if (pageResult.prices.length > 0) {
          allPrices.push(...pageResult.prices);
          if (!pricingPageUrl) pricingPageUrl = fullUrl;
        }
      }
    }
  }

  // 3. If no pricing found yet, try common pricing paths
  if (allPrices.length === 0) {
    for (const path of PRICING_PATHS.slice(0, 5)) {
      const url = `${baseUrl}${path}`;
      const html = await fetchWithTimeout(url);
      checkedPages++;
      if (html) {
        const result = extractPricingFromHtml(html, url);
        if (result.prices.length > 0) {
          allPrices.push(...result.prices);
          pricingPageUrl = url;
          break; // Found pricing, stop checking paths
        }
      }
    }
  }

  // Dedupe prices
  const seen = new Set<string>();
  allPrices = allPrices.filter(p => {
    if (seen.has(p.amount)) return false;
    seen.add(p.amount);
    return true;
  });

  return {
    id: installer.id,
    companyName: installer.company_name,
    website: installer.website,
    hasPricing: allPrices.length > 0,
    prices: allPrices.slice(0, 10), // Cap at 10 prices
    pricingPageUrl,
    checkedPages,
  };
}

async function runReport() {
  // Check if we have stored results in a temp table or just query the results
  // For now, let's look at what we've already found
  const results = await sql`
    SELECT * FROM installer_pricing_scan ORDER BY price_count DESC, installer_id
  `;

  if (results.length === 0) {
    console.log("No scan results found. Run without --report first.");
    await sql.end();
    return;
  }

  const withPricing = results.filter(r => r.has_pricing);
  console.log(`=== INSTALLERS WITH VISIBLE PRICING (${withPricing.length} / ${results.length} scanned) ===\n`);
  for (const r of withPricing) {
    console.log(`  [${r.installer_id}] ${r.company_name} | ${r.website}`);
    console.log(`    Pricing page: ${r.pricing_page_url}`);
    const prices = JSON.parse(r.prices || "[]");
    for (const p of prices.slice(0, 5)) {
      console.log(`    ${p.amount}: ...${p.context.slice(0, 120)}...`);
    }
    console.log();
  }

  await sql.end();
}

async function main() {
  if (REPORT_ONLY) return runReport();

  // Create results table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS installer_pricing_scan (
      installer_id INTEGER PRIMARY KEY REFERENCES installers(id),
      company_name TEXT NOT NULL,
      website TEXT,
      has_pricing BOOLEAN NOT NULL DEFAULT false,
      price_count INTEGER NOT NULL DEFAULT 0,
      prices TEXT, -- JSON array
      pricing_page_url TEXT,
      pages_checked INTEGER NOT NULL DEFAULT 0,
      scanned_at TEXT NOT NULL
    )
  `;

  // Get installers with websites that haven't been scanned yet
  const query = sql`
    SELECT i.id, i.company_name, i.website
    FROM installers i
    WHERE i.website IS NOT NULL AND i.website != ''
      AND i.is_shortlisted = true
      AND NOT EXISTS (SELECT 1 FROM installer_pricing_scan s WHERE s.installer_id = i.id)
    ORDER BY i.id
    ${LIMIT > 0 ? sql`LIMIT ${LIMIT}` : sql``}
  `;
  const installers: { id: number; company_name: string; website: string }[] = (await query) as never;

  console.log(`Found ${installers.length} installers to scan (${LIMIT > 0 ? `limit ${LIMIT}` : "all"})`);

  let processed = 0;
  let found = 0;
  let errors = 0;
  const startTime = Date.now();

  // Process in batches of CONCURRENCY
  for (let i = 0; i < installers.length; i += CONCURRENCY) {
    const batch = installers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(inst => checkInstaller(inst).catch(() => null)));

    for (const result of results) {
      if (!result) { errors++; processed++; continue; }

      await sql`
        INSERT INTO installer_pricing_scan (installer_id, company_name, website, has_pricing, price_count, prices, pricing_page_url, pages_checked, scanned_at)
        VALUES (${result.id}, ${result.companyName}, ${result.website}, ${result.hasPricing}, ${result.prices.length}, ${JSON.stringify(result.prices)}, ${result.pricingPageUrl}, ${result.checkedPages}, ${new Date().toISOString()})
        ON CONFLICT (installer_id) DO UPDATE SET
          has_pricing = EXCLUDED.has_pricing,
          price_count = EXCLUDED.price_count,
          prices = EXCLUDED.prices,
          pricing_page_url = EXCLUDED.pricing_page_url,
          pages_checked = EXCLUDED.pages_checked,
          scanned_at = EXCLUDED.scanned_at
      `;

      processed++;
      if (result.hasPricing) {
        found++;
        console.log(`  ✓ [${result.id}] ${result.companyName} — ${result.prices.length} prices found (${result.pricingPageUrl})`);
      }
    }

    // Progress update every 50
    if (processed % 50 === 0 || i + CONCURRENCY >= installers.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`  [${processed}/${installers.length}] ${found} with pricing | ${rate}/s | ${elapsed}s elapsed`);
    }
  }

  console.log(`\n=== SCAN COMPLETE ===`);
  console.log(`  Scanned: ${processed}`);
  console.log(`  With pricing: ${found}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Time: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
  console.log(`\nRun with --report to see full results.`);

  await sql.end();
}

main().catch(console.error);
