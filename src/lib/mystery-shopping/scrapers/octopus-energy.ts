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
  batteryProductName: string | null;
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
    // Open the address combobox and select a non-flat address
    console.log("[Octopus] Opening address combobox...");
    const combobox = page.locator('[role="combobox"]').first();
    await combobox.click();
    await page.waitForTimeout(2000);

    // Wait for options to load
    await page.waitForSelector('[role="option"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Get all address options and find a non-flat one
    const options = page.locator('[role="option"]');
    const optCount = await options.count();
    console.log("[Octopus] Address options:", optCount);

    let selectedOption = false;
    for (let i = 0; i < optCount; i++) {
      const text = await options.nth(i).textContent();
      const lower = (text || "").toLowerCase();
      // Skip flats, apartments, and units
      if (lower.includes("flat") || lower.includes("apartment") || lower.includes("unit ")) {
        console.log("[Octopus] Skipping flat:", text?.trim().slice(0, 60));
        continue;
      }
      console.log("[Octopus] Selecting address:", text?.trim().slice(0, 60));
      await options.nth(i).click();
      selectedOption = true;
      break;
    }

    if (!selectedOption) {
      // All addresses are flats — try scrolling down for more options or pick first anyway
      console.log("[Octopus] WARNING: All addresses appear to be flats, selecting first");
      if (optCount > 0) await options.first().click();
    }
    await page.waitForTimeout(1000);

    // Select usage tier — Medium
    await page.locator('button:has-text("Medium")').click().catch(() => {});
    await page.waitForTimeout(1000);

    // Tick the homeowner confirmation checkbox
    console.log("[Octopus] Ticking homeowner confirmation...");
    let checkboxTicked = false;

    // Try multiple selectors — the checkbox might be a label, input, or custom element
    const checkboxSelectors = [
      'text=I confirm',
      'label:has-text("confirm")',
      'label:has-text("homeowner")',
      '[type="checkbox"]',
      'input[type="checkbox"]',
      '[role="checkbox"]',
    ];

    for (const sel of checkboxSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        checkboxTicked = true;
        console.log("[Octopus] Checkbox ticked via:", sel);
        await page.waitForTimeout(500);
        break;
      }
    }

    if (!checkboxTicked) {
      // Last resort: find and click via evaluate
      await page.evaluate(() => {
        // Find checkbox inputs
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        for (const cb of checkboxes) {
          const label = cb.closest("label") || cb.parentElement;
          const text = label?.textContent || "";
          if (text.toLowerCase().includes("confirm") || text.toLowerCase().includes("homeowner")) {
            (cb as HTMLInputElement).click();
            return;
          }
        }
        // Click any visible checkbox as fallback
        if (checkboxes.length > 0) {
          (checkboxes[0] as HTMLInputElement).click();
        }
      });
      console.log("[Octopus] Checkbox ticked via evaluate fallback");
    }
    await page.waitForTimeout(1000);

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

    // Extract panel and battery product details from page text
    const productDetails = await readProductDetails(page);
    console.log("[Octopus] Product details:", JSON.stringify(productDetails));

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
        // Select battery — some options are disabled at certain panel counts
        const batteryLabel = page.locator(`label:has-text("${battery.selectorText}")`).first();

        // Check if visible
        if (!(await batteryLabel.isVisible({ timeout: 1000 }).catch(() => false))) {
          console.log(`[Octopus] ${panelCount} panels: ${battery.label} — not visible, skipping`);
          continue;
        }

        // Check if enabled (disabled options have aria-disabled or disabled attribute)
        const isDisabled = await batteryLabel.evaluate((el: Element) => {
          const input = el.querySelector("input");
          return el.getAttribute("aria-disabled") === "true" ||
            el.hasAttribute("disabled") ||
            (input && input.disabled) ||
            el.closest("[data-disabled]") !== null;
        }).catch(() => false);

        if (isDisabled) {
          console.log(`[Octopus] ${panelCount} panels: ${battery.label} — disabled, skipping`);
          continue;
        }

        // Try clicking — use force:true as fallback if normal click times out
        try {
          await batteryLabel.click({ timeout: 5000 });
        } catch {
          try {
            await batteryLabel.click({ force: true, timeout: 3000 });
          } catch {
            console.log(`[Octopus] ${panelCount} panels: ${battery.label} — click failed, skipping`);
            continue;
          }
        }
        await page.waitForTimeout(2000);

        // Read the pricing and active battery product name from the page
        const pricing = await readPricing(page);

        // Try to read the battery product name from the selected option's detail text
        const activeBatteryName = battery.capacityKwh > 0
          ? await readActiveBatteryProduct(page)
          : null;

        allQuotes.push({
          panelCount,
          batteryLabel: battery.label,
          batteryCapacityKwh: battery.capacityKwh,
          batteryProductName: activeBatteryName,
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
    // Build a lookup of the best battery product name per label (first non-null across panel counts)
    const batteryProductNames = new Map<string, string>();
    for (const q of allQuotes) {
      if (q.batteryProductName && !batteryProductNames.has(q.batteryLabel)) {
        batteryProductNames.set(q.batteryLabel, q.batteryProductName);
      }
    }

    const batteryOptions = defaultQuotes
      .filter((q) => q.estimatePrice)
      .map((q) => ({
        name: q.batteryLabel,
        model: batteryProductNames.get(q.batteryLabel) || q.batteryLabel,
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

      panelModel: productDetails.panelModel || "Octopus Solar Panels",
      panelWattage: productDetails.panelWattageW,
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
              batteryModel: q.batteryCapacityKwh > 0
                ? (batteryProductNames.get(q.batteryLabel) || q.batteryLabel)
                : null,
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

/**
 * Extract panel product details from the estimate page.
 * Searches for panel brand/model text outside of generic headings,
 * and also looks for wattage specs (e.g. "435W" near "panel").
 */
async function readProductDetails(page: any): Promise<{
  panelModel: string | null;
  panelWattageW: number | null;
}> {
  return page.evaluate(() => {
    let panelModel: string | null = null;
    let panelWattageW: number | null = null;

    // Collect text from all non-interactive, non-heading elements
    // that sit near the "panel" section of the page
    const knownBrands = [
      "JA Solar", "Trina", "Canadian Solar", "LONGi", "Longi",
      "Jinko", "SunPower", "Q.CELLS", "Q CELLS", "Hyundai",
      "Risen", "Astronergy", "Daikin", "Sharp", "Panasonic",
      "Maxeon", "REC Solar", "REC Alpha",
    ];

    // Search only <p>, <span>, <div> leaf text nodes — not <label> or <button>
    const candidates = document.querySelectorAll("p, span, div, li, td");
    for (const el of candidates) {
      if (el.children.length > 3) continue; // skip containers
      const text = (el as HTMLElement).innerText?.trim() || "";
      if (text.length < 5 || text.length > 200) continue;

      for (const brand of knownBrands) {
        if (text.includes(brand)) {
          // Extract the line containing the brand
          const lines = text.split("\n");
          const line = lines.find((l) => l.includes(brand))?.trim();
          if (line) {
            panelModel = line.replace(/[.,;:!]+$/, "").trim();
            const wm = panelModel.match(/(\d{3,4})\s*[Ww]p?/);
            if (wm) panelWattageW = parseInt(wm[1]);
          }
          break;
        }
      }
      if (panelModel) break;
    }

    // Try wattage pattern near "panel" text if no brand found
    if (!panelWattageW) {
      for (const el of candidates) {
        const text = (el as HTMLElement).innerText?.trim() || "";
        if (!/panel/i.test(text)) continue;
        const wm = text.match(/(\d{3,4})\s*[Ww]p?/);
        if (wm && parseInt(wm[1]) >= 200 && parseInt(wm[1]) <= 600) {
          panelWattageW = parseInt(wm[1]);
          break;
        }
      }
    }

    return { panelModel, panelWattageW };
  });
}

/**
 * Read the currently selected battery's product details.
 * Only looks at content directly associated with the checked radio option
 * (sibling/child description elements), NOT the full page body — because
 * all battery labels (including Tesla Powerwall 3) are always visible.
 */
async function readActiveBatteryProduct(page: any): Promise<string | null> {
  return page.evaluate(() => {
    const knownBrands = [
      "GivEnergy", "Huawei", "Tesla", "Fox ESS", "FoxESS",
      "SolarEdge", "Enphase", "BYD", "Pylontech", "Alpha ESS",
      "SolaX", "Sunsynk", "Growatt", "Solis", "Duracell",
    ];

    // Find the currently checked battery radio
    const radios = document.querySelectorAll('input[type="radio"]:checked');
    for (const radio of radios) {
      const label = radio.closest("label") || radio.parentElement?.closest("label");
      if (!label) continue;
      const labelText = (label.innerText || "").trim();
      if (!/kWh|battery|powerwall/i.test(labelText)) continue;

      // Walk up 1-3 levels from the label to find the option container
      let container: HTMLElement | null = label.parentElement as HTMLElement;
      for (let depth = 0; depth < 3 && container; depth++) {
        // Look for description elements OUTSIDE the label
        const children = container.querySelectorAll("p, span, div, small");
        for (const child of children) {
          if (label.contains(child)) continue; // skip the label itself
          const text = (child as HTMLElement).innerText?.trim() || "";
          if (text.length < 5 || text === labelText) continue;
          // Check if this text contains a battery brand name
          for (const brand of knownBrands) {
            if (text.includes(brand)) {
              return text.replace(/\n+/g, " ").trim();
            }
          }
        }

        // Check aria-describedby on the radio input
        const describedBy = radio.getAttribute("aria-describedby");
        if (describedBy) {
          const desc = document.getElementById(describedBy);
          if (desc) {
            const descText = desc.innerText?.trim();
            if (descText && descText.length > 3) return descText;
          }
        }

        container = container.parentElement as HTMLElement;
      }
    }

    return null;
  });
}
