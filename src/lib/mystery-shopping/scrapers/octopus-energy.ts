import type { ScraperResult, PropertyInput } from "./base";

/**
 * Octopus Energy Solar — Browserbase scraper.
 *
 * Octopus has no pricing API. The estimate is computed entirely client-side
 * in a Next.js app. Headless browsers fail (page shows £-- and never hydrates).
 * Browserbase provides real Chrome sessions that defeat Cloudflare.
 *
 * Funnel:
 *   1. /order/solar/ — postcode input
 *   2. /order/solar/property/?postcode=X — address select + usage tier
 *   3. /order/solar/estimate/ — panel count + battery options + live pricing
 *
 * Session-pooling: open one session per postcode, then permute panel count
 * and battery options on the /estimate/ page without re-navigating.
 *
 * Requires env vars: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
 */

interface BatteryConfig {
  label: string;
  selectorText: string;
  capacityKwh: number;
}

const BATTERY_OPTIONS: BatteryConfig[] = [
  { label: "None", selectorText: "None", capacityKwh: 0 },
  { label: "5kWh Smart", selectorText: "5kWh Smart battery", capacityKwh: 5 },
  { label: "5kWh Optimised", selectorText: "5kWh Optimised battery", capacityKwh: 5 },
  { label: "10kWh Smart", selectorText: "10kWh Smart battery", capacityKwh: 10 },
  { label: "10kWh Optimised", selectorText: "10kWh Optimised battery", capacityKwh: 10 },
  { label: "13.5kWh Tesla Powerwall 3", selectorText: "13.5kWh Tesla Powerwall 3", capacityKwh: 13.5 },
];

const PANEL_COUNTS = [6, 8, 10, 12, 14];

interface OctopusQuote {
  panelCount: number;
  batteryLabel: string;
  batteryCapacityKwh: number;
  estimatePrice: number | null;
  savingsPercentRange: string | null;
  savingsMonthlyRange: string | null;
  financeMonthly: number | null;
}

export async function scrapeOctopusEnergy(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return {
      success: false,
      platform: "octopus-energy",
      rawData: null,
      screenshotPath: null,
      error: "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set. Sign up at browserbase.com.",
    };
  }

  let browser: unknown = null;

  try {
    // Dynamic import — Playwright is only needed for Browserbase connection
    const { chromium } = await import("playwright");

    // Create a Browserbase session
    const sessionRes = await fetch("https://api.browserbase.com/v1/sessions", {
      method: "POST",
      headers: {
        "X-BB-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        browserSettings: {
          fingerprint: { locales: ["en-GB"] },
          viewport: { width: 1280, height: 800 },
        },
        // proxies: true, // paid plan only — enable if Cloudflare blocks without
      }),
    });

    if (!sessionRes.ok) {
      const errText = await sessionRes.text().catch(() => "");
      throw new Error(`Browserbase session creation failed (${sessionRes.status}): ${errText.slice(0, 200)}`);
    }

    const sessionData = await sessionRes.json();
    const connectUrl = sessionData.connectUrl;
    if (!connectUrl) throw new Error("No connectUrl in Browserbase response");

    // Connect Playwright to the remote Chrome session
    browser = await chromium.connectOverCDP(connectUrl);
    const ctx = (browser as any).contexts()[0];
    const page = ctx.pages()[0] || (await ctx.newPage());

    // === Step 1: Navigate to the solar order page ===
    console.log("[Octopus] Navigating to order page...");
    await page.goto("https://octopus.energy/order/solar/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log("[Octopus] Page loaded, URL:", page.url());

    // Dismiss cookie banner
    const cookieBtn = page.locator('button:has-text("That\'s cool")').first();
    if (await cookieBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cookieBtn.click();
      await page.waitForTimeout(1000);
    }

    // Enter postcode
    console.log("[Octopus] Entering postcode:", property.postcode);
    const postcodeInput = page.locator('input[type="text"]').first();
    await postcodeInput.fill(property.postcode);
    await page.waitForTimeout(500);

    // Click "Get a quote"
    console.log("[Octopus] Clicking Get a quote...");
    await page.locator('button:has-text("Get a quote")').first().click();
    await page.waitForTimeout(5000);
    console.log("[Octopus] Property page URL:", page.url());

    // === Step 2: Property page — select address and usage ===
    // Open the address combobox
    console.log("[Octopus] Opening address combobox...");
    const combobox = page.locator('[role="combobox"]').first();
    await combobox.click();
    await page.waitForTimeout(2000);

    // Select first non-flat address option
    const options = page.locator('[role="option"]');
    const optCount = await options.count();
    let selectedOption = false;
    for (let i = 0; i < optCount; i++) {
      const text = await options.nth(i).textContent();
      if (text && !text.toLowerCase().includes("flat")) {
        await options.nth(i).click();
        selectedOption = true;
        break;
      }
    }
    if (!selectedOption && optCount > 0) {
      await options.first().click();
    }
    await page.waitForTimeout(1000);

    // Select usage tier — Medium
    await page.locator('button:has-text("Medium")').click().catch(() => {});
    await page.waitForTimeout(1000);

    // Tick the homeowner confirmation checkbox
    console.log("[Octopus] Ticking homeowner confirmation...");
    const confirmCheckbox = page.locator('text=I confirm that I am the homeowner').first();
    if (await confirmCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmCheckbox.click();
      await page.waitForTimeout(500);
    } else {
      // Try clicking the checkbox input directly
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(500);
      }
    }

    // Click "Let's go!"
    console.log("[Octopus] Clicking Let's go...");
    await page.locator('button:has-text("Let\'s go")').click();
    await page.waitForTimeout(8000);
    console.log("[Octopus] Estimate page URL:", page.url());

    // Wait for the estimate page to hydrate
    console.log("[Octopus] Waiting for estimate to hydrate...");
    await page.waitForSelector('text=Your estimate', { timeout: 30000 }).catch(() => {
      console.log("[Octopus] WARNING: 'Your estimate' not found after 30s");
    });
    await page.waitForTimeout(3000);

    // Check if we got real pricing or £--
    const initialPricing = await readPricing(page);
    console.log("[Octopus] Initial pricing:", JSON.stringify(initialPricing));

    // === Step 3: Scrape pricing for different configurations ===
    const allQuotes: OctopusQuote[] = [];

    // Ensure "install solar panels" is selected
    const solarRadio = page.locator('label:has-text("I want to install solar panels")').first();
    if (await solarRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await solarRadio.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    for (const panelCount of PANEL_COUNTS) {
      // Set panel count
      await setPanelCount(page, panelCount);
      await page.waitForTimeout(1500);

      for (const battery of BATTERY_OPTIONS) {
        // Select battery
        const batteryLabel = page.locator(`label:has-text("${battery.selectorText}")`).first();
        if (await batteryLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
          await batteryLabel.click();
          await page.waitForTimeout(2000);
        } else {
          continue; // Battery option not available
        }

        // Read the pricing from the page
        const pricing = await readPricing(page);

        allQuotes.push({
          panelCount,
          batteryLabel: battery.label,
          batteryCapacityKwh: battery.capacityKwh,
          ...pricing,
        });
      }
    }

    // Build price matrix
    const defaultQuotes = allQuotes.filter((q) => q.panelCount === 10);
    const solarOnlyQuote = defaultQuotes.find((q) => q.batteryCapacityKwh === 0);

    // Panel price points (from "None" battery at each count)
    const panelPricePoints = allQuotes
      .filter((q) => q.batteryCapacityKwh === 0 && q.estimatePrice)
      .map((q) => ({ panelCount: q.panelCount, price: q.estimatePrice! }));

    // Unique battery options (from 10-panel config)
    const batteryOptions = defaultQuotes
      .filter((q) => q.estimatePrice)
      .map((q) => ({
        name: q.batteryLabel,
        model: q.batteryLabel,
        capacityKwh: q.batteryCapacityKwh,
        price: solarOnlyQuote?.estimatePrice ? q.estimatePrice! - solarOnlyQuote.estimatePrice : null,
        totalPrice: q.estimatePrice,
        savingsRange: q.savingsPercentRange,
        savingsMonthlyRange: q.savingsMonthlyRange,
        financeMonthly: q.financeMonthly,
      }));

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      installer: "Octopus Energy",

      panelModel: "Octopus Solar Panels",
      panelWattage: null,
      panelWarrantyYears: null,
      recommendedPanelCount: 10,
      pricePerPanel: null,
      panelOnlyPrice: solarOnlyQuote?.estimatePrice || null,
      totalPrice: solarOnlyQuote?.estimatePrice || (defaultQuotes[0]?.estimatePrice || null),

      batteryOptions,
      panelPricePoints,

      // Full price table
      priceTable: Object.fromEntries(
        PANEL_COUNTS.map((pc) => [
          String(pc),
          allQuotes
            .filter((q) => q.panelCount === pc && q.estimatePrice)
            .map((q) => ({
              name: q.batteryLabel,
              price: q.estimatePrice!,
              isBattery: q.batteryCapacityKwh > 0,
              batteryCost: solarOnlyQuote?.estimatePrice ? q.estimatePrice! - solarOnlyQuote.estimatePrice : 0,
              batteryCapacityKwh: q.batteryCapacityKwh || null,
              batteryModel: q.batteryCapacityKwh > 0 ? q.batteryLabel : null,
            })),
        ])
      ),

      _allQuotes: allQuotes,
    };

    return {
      success: true,
      platform: "octopus-energy",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "octopus-energy",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) {
      await (browser as any).close().catch(() => {});
    }
  }
}

/** Set panel count by clicking the − and + buttons near the panel counter */
async function setPanelCount(page: any, target: number): Promise<void> {
  // Strategy: Use Playwright locators scoped to the panels section.
  // The panel stepper has "−" [number] "+" with nearby text mentioning "panel".
  // We find the minus and plus buttons that are siblings of the panel count display.

  for (let attempt = 0; attempt < 30; attempt++) {
    // Read current panel count — find number near panel-related text
    const info = await page.evaluate(() => {
      // Find all visible number displays (2-30)
      const results: Array<{ num: number; rect: DOMRect; parentText: string }> = [];
      document.querySelectorAll("*").forEach((el) => {
        if (el.children.length > 0) return;
        const t = el.textContent?.trim();
        if (!t || !/^\d{1,2}$/.test(t)) return;
        const n = parseInt(t);
        if (n < 2 || n > 30) return;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0) return;
        // Get parent context to disambiguate panel vs expansion counters
        let ctx = el.parentElement;
        let parentText = "";
        for (let i = 0; i < 5 && ctx; i++) {
          parentText = ctx.textContent || "";
          if (parentText.length > 20) break;
          ctx = ctx.parentElement;
        }
        results.push({ num: n, rect, parentText: parentText.slice(0, 200) });
      });
      return results;
    });

    // Find the one near "panel" text (not "expansion" or "Powerwall")
    const panelCounter = info.find((i: any) =>
      i.parentText.toLowerCase().includes("panel") &&
      !i.parentText.toLowerCase().includes("expansion")
    ) || info[0];

    const current = panelCounter?.num;
    console.log("[Octopus] Panel count: current=" + current + " target=" + target +
      " (found " + info.length + " counters)");

    if (current === target) break;
    if (current == null) {
      console.log("[Octopus] Could not read panel count");
      break;
    }

    // Click +/- using Playwright locator with force:true
    // The buttons are typically labeled with − and + characters
    if (current < target) {
      // Need to click + — find it near the panel counter position
      await page.evaluate((counterY: number) => {
        const buttons = document.querySelectorAll("button");
        let best: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const btn of buttons) {
          const t = btn.textContent?.trim();
          if (t !== "+" && t !== "＋") continue;
          const r = btn.getBoundingClientRect();
          const dist = Math.abs(r.y - counterY);
          if (dist < bestDist) {
            bestDist = dist;
            best = btn as HTMLElement;
          }
        }
        if (best && bestDist < 100) best.click();
      }, panelCounter.rect.y);
    } else {
      await page.evaluate((counterY: number) => {
        const buttons = document.querySelectorAll("button");
        let best: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const btn of buttons) {
          const t = btn.textContent?.trim();
          if (t !== "−" && t !== "-" && t !== "–") continue;
          const r = btn.getBoundingClientRect();
          const dist = Math.abs(r.y - counterY);
          if (dist < bestDist) {
            bestDist = dist;
            best = btn as HTMLElement;
          }
        }
        if (best && bestDist < 100) best.click();
      }, panelCounter.rect.y);
    }

    await page.waitForTimeout(800);
  }

  // Wait for price recalculation
  await page.waitForTimeout(2000);
}

/** Read pricing from the /estimate/ page */
async function readPricing(page: any): Promise<{
  estimatePrice: number | null;
  savingsPercentRange: string | null;
  savingsMonthlyRange: string | null;
  financeMonthly: number | null;
}> {
  return page.evaluate(() => {
    const body = document.body.innerText;

    // "Your estimate: £8,872"
    const priceMatch = body.match(/Your estimate:\s*£([\d,]+)/);
    const estimatePrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null;

    // "bill savings of 109-131%, £86-£103"
    const savingsMatch = body.match(/bill savings of\s*([\d-]+%),\s*£([\d]+)-£([\d]+)/);
    const savingsPercentRange = savingsMatch ? savingsMatch[1] : null;
    const savingsMonthlyRange = savingsMatch ? `£${savingsMatch[2]}-£${savingsMatch[3]}/mo` : null;

    // "Finance available from: £114 per month"
    const financeMatch = body.match(/Finance available from:\s*£([\d]+)\s*per month/);
    const financeMonthly = financeMatch ? parseInt(financeMatch[1]) : null;

    return { estimatePrice, savingsPercentRange, savingsMonthlyRange, financeMonthly };
  });
}
