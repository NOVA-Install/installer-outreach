import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";
import { BURNER_IDENTITY } from "./burner-identity";

/**
 * Eco Providers Solar Quote scraper — browser-based.
 * URL: https://www.ecoproviders.co.uk/solar-fixed-quote-form/
 *
 * 4-stage WordPress form:
 *   1. Postcode
 *   2. Roof type (Pitched/Dormer/Flat) + material (Concrete/Slate/Rosemary)
 *   3. Contact details + electricity usage + panel quantity adjuster
 *   4. Package selection with pricing display
 *
 * Shows dynamic pricing with adjustable panel count and optional upgrades.
 * Requires contact details at stage 3 to proceed.
 */
export async function scrapeEcoProvidersSolar(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    await navigateAndSettle(page, url, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Dismiss cookies
    for (const text of ["Reject", "Deny", "Accept", "Got it", "Close"]) {
      const btn = page.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(1000);

    // Stage 1: Postcode
    const postcodeInput = page.locator('input[name*="postcode" i], input[placeholder*="postcode" i], input[type="text"]').first();
    if (await postcodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await postcodeInput.fill(property.postcode);
      await page.waitForTimeout(500);
    }
    await clickNext(page);

    // Stage 2: Roof type + material
    const roofType = property.roofType === "flat" ? "Flat" : "Pitched";
    await clickOption(page, roofType);
    await page.waitForTimeout(1000);
    // Material — default to Concrete for pitched
    await clickOption(page, "Concrete");
    await page.waitForTimeout(500);
    await clickOption(page, "Slate");
    await page.waitForTimeout(500);
    await clickNext(page);

    // Stage 3: Contact details + usage
    // Fill minimal contact details
    const fields = [
      { sel: 'input[name*="email" i], input[type="email"]', val: BURNER_IDENTITY.email },
      { sel: 'input[name*="phone" i], input[type="tel"]', val: BURNER_IDENTITY.phone },
      { sel: 'input[name*="first" i]', val: BURNER_IDENTITY.firstName },
      { sel: 'input[name*="last" i], input[name*="surname" i]', val: BURNER_IDENTITY.lastName },
    ];
    for (const { sel, val } of fields) {
      const input = page.locator(sel).first();
      if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
        await input.fill(val);
      }
    }

    // Select title if present
    const titleSelect = page.locator('select[name*="title" i]').first();
    if (await titleSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await titleSelect.selectOption({ label: BURNER_IDENTITY.title }).catch(() => {});
    }

    // Electricity usage — select Medium
    await clickOption(page, "Medium");
    await page.waitForTimeout(1000);

    await clickNext(page);

    // Stage 4: Package selection with pricing
    await page.waitForTimeout(3000);

    // Take screenshot and extract pricing
    const screenshotPath = await takeScreenshot(page, "ecoproviders-solar");
    const pageText = await getPageText(page);

    // Extract pricing from the page
    const priceData = await page.evaluate(() => {
      const text = document.body.innerText;

      // Look for total price
      const totalMatch = text.match(/(?:total|price)\s*:?\s*£([\d,]+(?:\.\d{2})?)/i);
      // Monthly price
      const monthlyMatch = text.match(/(?:monthly|per month|\/mo)\s*:?\s*£([\d,.]+)/i)
        || text.match(/£([\d,.]+)\s*(?:\/month|per month|monthly)/i);
      // Annual savings
      const savingsMatch = text.match(/(?:annual|yearly)\s*savings?\s*:?\s*£([\d,]+)/i)
        || text.match(/save\s*£([\d,]+)/i);
      // Panel count
      const panelMatch = text.match(/(\d+)\s*(?:solar\s*)?panels?/i);
      // Panel wattage
      const wattMatch = text.match(/(\d+)\s*[wW](?:att)?/);

      // Get all prices on the page
      const allPrices = [...text.matchAll(/£([\d,]+(?:\.\d{2})?)/g)]
        .map((m) => parseFloat(m[1].replace(/,/g, "")))
        .filter((p) => p > 100);

      return {
        totalPrice: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : null,
        monthlyPrice: monthlyMatch ? parseFloat(monthlyMatch[1].replace(/,/g, "")) : null,
        annualSavings: savingsMatch ? parseFloat(savingsMatch[1].replace(/,/g, "")) : null,
        panelCount: panelMatch ? parseInt(panelMatch[1]) : null,
        panelWattage: wattMatch ? parseInt(wattMatch[1]) : null,
        allPrices: [...new Set(allPrices)].sort((a, b) => a - b),
      };
    });

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      panelModel: null as string | null,
      panelWarrantyYears: null,
      recommendedPanelCount: priceData.panelCount,
      pricePerPanel: null,
      panelOnlyPrice: null,
      totalPrice: priceData.totalPrice,
      annualSavings: priceData.annualSavings,
      monthlySavings: priceData.monthlyPrice,
      batteryOptions: [] as Array<Record<string, unknown>>,
      allPrices: priceData.allPrices,
    };

    // If no total price found, try the largest price
    if (!priceMatrix.totalPrice && priceData.allPrices.length > 0) {
      const validPrices = priceData.allPrices.filter((p) => p > 2000 && p < 30000);
      if (validPrices.length > 0) {
        priceMatrix.totalPrice = validPrices[validPrices.length - 1];
      }
    }

    return {
      success: true,
      platform: "ecoproviders-solar",
      rawData: { priceMatrix, pageText: pageText.slice(0, 3000) },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "ecoproviders-solar-error").catch(() => null);
    return {
      success: false,
      platform: "ecoproviders-solar",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function clickOption(page: Page, text: string): Promise<void> {
  for (const sel of [
    `label:has-text("${text}")`,
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
    `text="${text}"`,
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
      await el.click().catch(() => {});
      return;
    }
  }
}

async function clickNext(page: Page): Promise<void> {
  for (const text of ["Next", "Continue", "Get Quote", "Submit", "See my quote"]) {
    const btn = page.locator(`button:has-text("${text}"), input[value="${text}"]`).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(2000);
      return;
    }
  }
}
