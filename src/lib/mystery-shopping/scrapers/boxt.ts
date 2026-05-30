import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";

/**
 * BOXT Solar Configurator scraper.
 * URL: https://app.boxt.co.uk/solar/configurator
 *
 * Flow (tested May 2026):
 *   Q1: "Do you own your home?" → Yes (auto-advances)
 *   Q2: "What type of roof do you have?" → Pitched/Flat (auto-advances)
 *   Q3: "What is your typical household electricity usage?" → Low/Medium/High (auto-advances)
 *   Q4: "What is your main reason for considering solar?" → Lower energy bills (auto-advances)
 *   → Map: enter postcode → select address → confirm
 *   → Possible "Are you in a flat?" modal → select property type → Update
 *   → "Preparing your solar quote..." loading → "View solar quote"
 *   → Configurator page: Panels (stepper 4-20), Battery (tiers + models), Savings
 *
 * Click strategy:
 *   - Q1-Q4: Playwright locator.click() — works fine, no overlays
 *   - Address/Confirm: page.click() — handles scroll containers correctly
 *   - Flat modal: page.evaluate() — custom radio selection
 *   - Configurator page: page.click() with force:true fallback
 *
 * IMPORTANT: Do NOT call clearModals() after "View solar quote" — removing
 * React-managed DOM elements causes the app to reset to address selection.
 */

interface BatteryOption {
  tier: string;
  model: string;
  capacityKwh: number | null;
  totalPrice: number;
  monthlySavings: string | null;
}

interface PanelPricePoint {
  panelCount: number;
  systemKw: string;
  totalPrice: number;
}

interface BoxtPriceMatrix {
  address: string;
  postcode: string;
  roofType: string;
  electricityUsage: string;
  panelModel: string | null;
  panelWarrantyYears: number | null;
  recommendedPanelCount: number | null;
  panelOnlyPrice: number | null;
  pricePerPanel: number | null;
  panelPricePoints: PanelPricePoint[];
  batteryOptions: BatteryOption[];
  includedExtras: string[];
}

export async function scrapeBoxt(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    await navigateAndSettle(page, url, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Dismiss cookie banner
    const rejectCookies = page.locator('button:has-text("Reject All")').first();
    if (await rejectCookies.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rejectCookies.click();
      await page.waitForTimeout(1000);
    }

    // === Q1-Q4: Initial questions (no overlays, normal clicks work) ===
    await clickOption(page, "Yes");                                         // Q1: Own home
    await clickOption(page, property.roofType === "flat" ? "Flat" : "Pitched"); // Q2: Roof type
    await clickOption(page, mapUsage(property.annualElectricityUsage));      // Q3: Usage
    await clickOption(page, "Lower energy bills");                          // Q4: Reason
    await page.waitForTimeout(2000);

    // === Address selection ===
    const postcodeInput = page.locator('input[placeholder*="postcode" i], input[type="text"]').first();
    await postcodeInput.waitFor({ state: "visible", timeout: 10000 });
    await postcodeInput.fill(property.postcode);
    await page.waitForTimeout(500);

    await page.click('button:has-text("Search"), button[type="submit"]', { timeout: 5000 });
    await page.waitForTimeout(3000);

    // Select a non-flat address from the list
    await page.waitForSelector('button:has-text(",")', { timeout: 10000 }).catch(() => {});

    // Find and click the first address that doesn't contain "Flat"
    const addressClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        if (text.includes(",") && !text.toLowerCase().includes("flat") && text.length > 10) {
          btn.click();
          return text;
        }
      }
      // Fallback: click the first address even if it's a flat
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        if (text.includes(",") && text.length > 10) {
          btn.click();
          return text;
        }
      }
      return null;
    });
    await page.waitForTimeout(1000);

    // Confirm address
    await page.click('button:has-text("Confirm address")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // === "Are you in a flat?" modal ===
    const flatModal = page.locator('text="Are you in a flat?"');
    if (await flatModal.isVisible({ timeout: 5000 }).catch(() => false)) {
      const propertyType = mapPropertyType(property.propertyType);

      // Select the property type radio using React's native input setter.
      // Boxt's radios are hidden <input> elements behind styled circles.
      // We find the right input, set its value via React's internal setter
      // (Object.getOwnPropertyDescriptor on HTMLInputElement prototype),
      // and fire change/input events that React's synthetic event system recognises.
      await page.evaluate((targetType) => {
        // Find all elements containing property type text
        const allEls = document.querySelectorAll("*");
        for (const el of allEls) {
          const directText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim())
            .join("");
          if (directText !== targetType) continue;

          // Walk up to find the clickable container with radio input
          let container = el.parentElement;
          for (let i = 0; i < 8 && container; i++) {
            const radio = container.querySelector('input[type="radio"], input[type="checkbox"]') as HTMLInputElement | null;
            if (radio) {
              // Use React's internal setter to trigger state change
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype, "checked"
              )?.set;
              if (nativeInputValueSetter) {
                nativeInputValueSetter.call(radio, true);
              } else {
                radio.checked = true;
              }
              radio.dispatchEvent(new Event("input", { bubbles: true }));
              radio.dispatchEvent(new Event("change", { bubbles: true }));
              radio.dispatchEvent(new Event("click", { bubbles: true }));
              // Also click the container for good measure
              container.click();
              return;
            }
            container = container.parentElement;
          }
          // No radio found — click the text element's container
          el.parentElement?.click();
          return;
        }
      }, propertyType);
      await page.waitForTimeout(1500);

      // Click Update button
      const updateBtn = page.locator('button:has-text("Update")').last();
      const updateBox = await updateBtn.boundingBox();
      if (updateBox) {
        await page.mouse.click(updateBox.x + updateBox.width / 2, updateBox.y + updateBox.height / 2);
      }
      await page.waitForTimeout(5000);
    }

    // === Wait for quote generation + click "View solar quote" ===
    await waitForQuoteReady(page);

    // === CONFIGURATOR PAGE — extract price matrix ===
    const matrix: BoxtPriceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType === "flat" ? "Flat" : "Pitched",
      electricityUsage: mapUsage(property.annualElectricityUsage),
      panelModel: null,
      panelWarrantyYears: null,
      recommendedPanelCount: null,
      panelOnlyPrice: null,
      pricePerPanel: null,
      panelPricePoints: [],
      batteryOptions: [],
      includedExtras: [],
    };

    // Extract panel info from page text
    const info = await extractPanelInfo(page);
    matrix.recommendedPanelCount = info.panelCount;
    matrix.panelModel = info.panelModel;
    matrix.panelWarrantyYears = info.warrantyYears;

    // --- PANELS: record the default recommended config price ---
    const defaultPrice = await readPrice(page);

    // --- BATTERIES ---

    // Panel-only baseline
    if (await clickByCoords(page, "Panel only installation")) {
      await page.waitForTimeout(2000);
      matrix.panelOnlyPrice = await readPrice(page);
    }

    // Cycle through battery tiers and extract each unique model + price
    for (const tier of ["5-8 kWh", "9-12 kWh", "13+ kWh"]) {
      if (!(await clickByCoords(page, tier))) continue;
      await page.waitForTimeout(2500);

      // Get all visible battery models for this tier
      const models = await findBatteryModels(page);

      for (const model of models) {
        // Click this battery model
        if (await clickByCoords(page, model.name)) {
          await page.waitForTimeout(2000);
        }

        const price = await readPrice(page);
        const savings = await readSavings(page);

        if (price) {
          matrix.batteryOptions.push({
            tier,
            model: model.name,
            capacityKwh: model.capacityKwh,
            totalPrice: price,
            monthlySavings: savings,
          });
        }
      }
    }

    // Deduplicate battery options (same model+capacity can appear multiple times)
    matrix.batteryOptions = deduplicateBatteries(matrix.batteryOptions);

    // --- EXTRAS ---
    matrix.includedExtras = await extractExtras(page);

    const screenshotPath = await takeScreenshot(page, "boxt");

    return {
      success: true,
      platform: "boxt",
      rawData: { priceMatrix: matrix, url: page.url() },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "boxt-error").catch(() => null);
    return {
      success: false,
      platform: "boxt",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Click a heading/option in the initial Q1-Q4 flow (no overlays). */
async function clickOption(page: Page, text: string): Promise<void> {
  for (const tag of ["h1", "h2", "h3", "h4", ""]) {
    const sel = tag ? `${tag}:has-text("${text}")` : `text="${text}"`;
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(1500);
      return;
    }
  }
  throw new Error(`Could not find option: ${text}`);
}

/**
 * Click an element by finding it via text, getting its bounding box,
 * and using page.mouse.click at the coordinates. This bypasses all
 * overlay interception because the mouse event goes to the screen
 * position, not through DOM event routing.
 */
/**
 * Click an element by finding it via text and clicking at a position
 * that hits both the text AND the radio circle to its left.
 * Boxt uses radio circles ~20px left of the label text.
 */
/**
 * Click a radio/option by its text. Uses the same React native setter
 * approach that works for the flat modal — finds the nearest radio input
 * to the text and triggers it properly. Falls back to coordinate click.
 */
async function clickByCoords(page: Page, text: string): Promise<boolean> {
  // First try: React native setter approach (most reliable)
  const clicked = await page.evaluate((searchText) => {
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .join("");
      if (directText !== searchText) continue;

      // Walk up to find a radio input
      let container = el.parentElement;
      for (let i = 0; i < 8 && container; i++) {
        const radio = container.querySelector('input[type="radio"], input[type="checkbox"]') as HTMLInputElement | null;
        if (radio) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
          if (setter) setter.call(radio, true);
          else radio.checked = true;
          radio.dispatchEvent(new Event("input", { bubbles: true }));
          radio.dispatchEvent(new Event("change", { bubbles: true }));
          radio.dispatchEvent(new Event("click", { bubbles: true }));
          container.click();
          return true;
        }
        container = container.parentElement;
      }
      // No radio — just click the element
      (el as HTMLElement).click();
      return true;
    }
    return false;
  }, text);

  if (clicked) return true;

  // Fallback: coordinate click
  const locator = page.locator(`text="${text}"`).first();
  if (!(await locator.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

/** Click the minus button on the panel stepper.
 *  The +/- buttons have EMPTY text (symbols rendered as SVG/CSS).
 *  We find them by locating 40x40 buttons near the "kW system" text,
 *  then use Playwright locator click on the first one (minus is before plus).
 */
/** Click the minus button on the panel stepper.
 *  Adds a data attribute to the button via evaluate, then clicks it
 *  with Playwright locator — this bypasses coordinate issues with
 *  fixed/scrollable containers.
 */
async function clickMinusButton(page: Page): Promise<boolean> {
  // Tag the minus button with a data attribute so Playwright can target it
  const tagged = await page.evaluate(() => {
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      if (el.children.length > 0) continue;
      if (!/[\d.]+kW system/i.test(el.textContent || "")) continue;

      let container = el.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const buttons = Array.from(container.querySelectorAll("button")).filter(b => {
          const r = b.getBoundingClientRect();
          return b.textContent?.trim() === "" && r.width >= 30 && r.width <= 55;
        });
        if (buttons.length >= 2) {
          buttons[0].setAttribute("data-scraper-minus", "true");
          return true;
        }
        container = container.parentElement;
      }
    }
    return false;
  });

  if (!tagged) return false;

  // Now use Playwright's locator which handles scroll containers properly
  const btn = page.locator('[data-scraper-minus="true"]').first();
  try {
    await btn.click({ timeout: 5000 });
    return true;
  } catch {
    try {
      await btn.click({ force: true, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}


/**
 * Wait for quote generation to complete and click "View solar quote".
 * Polls for the button to appear (up to 60s) then clicks it.
 */
async function waitForQuoteReady(page: Page): Promise<void> {
  // Poll for "View solar quote" button to appear (quote generation takes time)
  for (let i = 0; i < 60; i++) {
    const viewBtn = page.locator('button:has-text("View solar quote")').first();
    if (await viewBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.click('button:has-text("View solar quote")', { timeout: 5000 }).catch(async () => {
        await viewBtn.click({ force: true, timeout: 5000 }).catch(() => {});
      });
      await page.waitForTimeout(5000);
      return;
    }
    await page.waitForTimeout(1000);
  }
}

/** Read total price from sticky footer. */
async function readPrice(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    // Sticky footer: £X,XXX\nFrom £XX.XX per month
    const m = text.match(/£([\d,]+)\s*\n\s*From £[\d.]+ per month/);
    if (m) return Number(m[1].replace(/,/g, ""));
    // "Full system price" section
    const m2 = text.match(/Full system price\s*£([\d,]+)/);
    if (m2) return Number(m2[1].replace(/,/g, ""));
    return null;
  });
}

/** Read panel count + system kW from the stepper display. */
async function readPanelCount(page: Page): Promise<{ count: number; kw: string } | null> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/(\d+)\s*\n\s*([\d.]+)kW system/);
    if (m) return { count: Number(m[1]), kw: m[2] + "kW" };
    const m2 = text.match(/(\d+)\s*panels?\s*\n\s*([\d.]+)kW/);
    if (m2) return { count: Number(m2[1]), kw: m2[2] + "kW" };
    return null;
  });
}

/** Read monthly savings from the selected battery option. */
async function readSavings(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const m = document.body.innerText.match(/Electricity bill savings\*?\s*£([\d,.]+)\/mo/i);
    return m ? `£${m[1]}/mo` : null;
  });
}

/**
 * Find unique battery models visible on the page.
 * Matches headings containing known brand names, deduplicates by name.
 */
async function findBatteryModels(page: Page): Promise<Array<{ name: string; capacityKwh: number | null }>> {
  return page.evaluate(() => {
    const results: Array<{ name: string; capacityKwh: number | null }> = [];
    const seen = new Set<string>();

    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const h of headings) {
      const text = h.textContent?.trim() || "";
      // Match known battery brand names
      if (!/Sunsynk|Tesla|GivEnergy|Huawei|Fox ESS|BYD/i.test(text)) continue;
      // Skip the "1x Model (kWh)" detail text — we want the selectable options
      if (text.startsWith("1x")) continue;

      // Parse capacity: look for "X.XkWh" in the NEXT sibling or parent's direct text
      let capacity: number | null = null;
      // Check next sibling element
      const nextEl = h.nextElementSibling;
      if (nextEl) {
        const nextText = nextEl.textContent?.trim() || "";
        const capMatch = nextText.match(/^([\d.]+)\s*kWh$/i);
        if (capMatch) capacity = parseFloat(capMatch[1]);
      }
      // Fallback: check parent for a kWh value right after the model name
      if (capacity === null) {
        const parent = h.parentElement;
        const parentText = parent?.textContent || "";
        // Match "Model Name\nX.XkWh" pattern
        const capMatch = parentText.match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*([\\.\\d]+)\\s*kWh", "i"));
        if (capMatch) capacity = parseFloat(capMatch[1]);
      }

      const key = text;
      if (seen.has(key)) continue;
      seen.add(key);

      const rect = h.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({ name: text, capacityKwh: capacity });
      }
    }
    return results;
  });
}

/** Deduplicate battery options by model name + capacity. */
function deduplicateBatteries(options: BatteryOption[]): BatteryOption[] {
  const seen = new Map<string, BatteryOption>();
  for (const opt of options) {
    const key = `${opt.tier}|${opt.model}|${opt.capacityKwh}`;
    if (!seen.has(key)) {
      seen.set(key, opt);
    }
  }
  return [...seen.values()];
}

/** Extract panel model, count, and warranty from page text. */
async function extractPanelInfo(page: Page): Promise<{
  panelCount: number | null;
  panelModel: string | null;
  warrantyYears: number | null;
}> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const countMatch = text.match(/We recommend (\d+) panels/i);
    const modelMatch = text.match(/((?:AIKO|JA Solar|Trina|Canadian Solar|Longi|Jinko)[\w\s\-.]+ \d+W)/i);
    const warrantyMatch = text.match(/(\d+)\s*year\s*(?:manufacturer\s*)?guarantee/i);
    return {
      panelCount: countMatch ? Number(countMatch[1]) : null,
      panelModel: modelMatch ? modelMatch[1].trim() : null,
      warrantyYears: warrantyMatch ? Number(warrantyMatch[1]) : null,
    };
  });
}

/** Extract included extras (scaffolding, MCS, etc.) from page text. */
async function extractExtras(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const patterns = [
      /Buy one solar panel, get one free/i,
      /Scaffolding and access equipment/i,
      /Fully MCS compliant installation/i,
      /HIES deposit protection insurance/i,
      /TrustMark/i,
    ];
    return patterns.map((p) => text.match(p)?.[0]).filter((m): m is string => !!m);
  });
}

function mapUsage(kWh?: number): string {
  if (!kWh) return "Medium";
  if (kWh < 2500) return "Low";
  if (kWh > 4500) return "High";
  return "Medium";
}

function mapPropertyType(type?: string): string {
  if (!type) return "Detached";
  const l = type.toLowerCase();
  if (l.includes("semi")) return "Semi-detached";
  if (l.includes("terrace")) return "Terraced";
  if (l.includes("bungalow")) return "Bungalow";
  return "Detached";
}
