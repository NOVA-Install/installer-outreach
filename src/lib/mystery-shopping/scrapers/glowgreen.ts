import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";

/**
 * GlowGreen scraper — browser-based with WAF bypass.
 *
 * GlowGreen uses Nuxt.js (Vue) with aggressive Cloudflare WAF protection
 * that blocks all automated HTTP requests (returns 403).
 *
 * Strategy: Use Playwright in headed mode (real browser window).
 * Cloudflare's bot detection typically lets through real browser instances
 * because they have valid TLS fingerprints, WebGL, Canvas, etc.
 *
 * If Cloudflare presents a challenge page, we wait for it to resolve
 * (the "checking your browser" interstitial usually auto-resolves in 3-5s).
 *
 * The quote form asks about property type, roof direction, postcode,
 * electricity usage. Results are likely displayed after form submission
 * or an account manager calls you.
 *
 * Note: GlowGreen may be lead-gen only (no instant pricing shown).
 * Even so, we capture whatever data the form/results page shows.
 */
export async function scrapeGlowGreen(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    // Navigate with a longer timeout — Cloudflare challenge may take time
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for Cloudflare challenge to resolve (if present)
    // The challenge page typically has "checking your browser" or "Just a moment"
    for (let i = 0; i < 30; i++) {
      const pageText = await page.evaluate(() => document.body?.innerText || "");
      if (pageText.includes("Just a moment") || pageText.includes("Checking your browser") || pageText.includes("challenge")) {
        await page.waitForTimeout(2000);
        continue;
      }
      break;
    }

    await page.waitForTimeout(3000);

    // Check if we got past the WAF
    const bodyText = await getPageText(page);
    if (bodyText.includes("Access denied") || bodyText.includes("403") || bodyText.length < 100) {
      return {
        success: false,
        platform: "glowgreen",
        rawData: null,
        screenshotPath: await takeScreenshot(page, "glowgreen-blocked").catch(() => null),
        error: "Blocked by WAF — try running in headed mode with slowMo",
      };
    }

    // Try to extract Nuxt data store
    const nuxtData = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      return {
        nuxtData: win.__NUXT_DATA__ ? JSON.stringify(win.__NUXT_DATA__).slice(0, 3000) : null,
        nuxt: win.__NUXT__ ? JSON.stringify(win.__NUXT__).slice(0, 3000) : null,
      };
    });

    // Try to fill the form if it's visible
    // GlowGreen asks: property type, roof direction, postcode, usage
    const postcodeInput = page.locator('input[placeholder*="postcode" i], input[name*="postcode" i]').first();
    if (await postcodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await postcodeInput.fill(property.postcode);
      await page.waitForTimeout(1000);
    }

    // Try clicking through form steps
    const propertyType = property.propertyType || "house";
    for (const text of [propertyType, "House", "South", "south", "Submit", "Get Quote", "Next"]) {
      const btn = page.locator(`text="${text}"`).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    await page.waitForTimeout(3000);
    const screenshotPath = await takeScreenshot(page, "glowgreen");
    const finalText = await getPageText(page);

    // Extract any pricing data
    const prices = [...finalText.matchAll(/£([\d,]+(?:\.\d{2})?)/g)].map((m) => m[0]);

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      allPrices: prices,
      pageText: finalText.slice(0, 3000),
      nuxtData: nuxtData.nuxtData || nuxtData.nuxt,
      note: prices.length === 0
        ? "GlowGreen appears to be lead-gen only — no instant pricing shown. An account manager will call."
        : undefined,
    };

    return {
      success: true,
      platform: "glowgreen",
      rawData: { priceMatrix },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "glowgreen-error").catch(() => null);
    return {
      success: false,
      platform: "glowgreen",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
