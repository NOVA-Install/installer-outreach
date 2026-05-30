import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";

/**
 * ESE Solar scraper — browser-based.
 *
 * ESE Solar's /solar-form/ page is broken, but /long-solar-form/ works.
 * It has a multi-step wizard with Google Maps roof drawing.
 *
 * Strategy: Skip the map drawing step and directly set the hidden fields
 * (h_totalarea, h_panelsneeded) via JavaScript, then extract the pricing
 * from the summary page.
 *
 * The pricing is calculated client-side based on:
 *   - Number of panels (based on roof area)
 *   - Battery count (0, 1, or 2)
 *   - Inverter (yes/no)
 *   - Panel wattage: 430W
 *
 * Note: Primarily a lead generation form — shows estimated savings
 * and a "From: £X" price but detailed quote requires contact.
 */
export async function scrapeEseSolar(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    // Use the working long form URL
    const formUrl = "https://esesolar.co.uk/long-solar-form/";
    await navigateAndSettle(page, formUrl, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Fill in address
    const addressInput = page.locator('input[placeholder*="Address" i], input[placeholder*="address" i]').first();
    if (await addressInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addressInput.fill(`${property.address}, ${property.postcode}`);
      await page.waitForTimeout(2000);

      // Select first autocomplete suggestion
      const suggestion = page.locator('.pac-item, [class*="autocomplete"] li, [role="option"]').first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
        await page.waitForTimeout(1000);
      }
    }

    // Click Next to proceed past address
    await clickBtn(page, "Next");

    // Fill contact details (required to proceed)
    const firstNameInput = page.locator('input[name*="firstname" i], input[placeholder*="First" i]').first();
    if (await firstNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstNameInput.fill("Sarah");
      const lastNameInput = page.locator('input[name*="lastname" i], input[placeholder*="Last" i]').first();
      await lastNameInput.fill("Jones").catch(() => {});
      const emailInput = page.locator('input[type="email"], input[name*="email" i]').first();
      await emailInput.fill("quote@example.com").catch(() => {});
      const phoneInput = page.locator('input[type="tel"], input[name*="phone" i]').first();
      await phoneInput.fill("07700900000").catch(() => {});
    }

    await clickBtn(page, "Next");

    // Property type selection
    const propType = property.propertyType || "detached";
    for (const text of [propType, "Detached", "Semi-Detached"]) {
      const radio = page.locator(`label:has-text("${text}"), input[value="${text}" i]`).first();
      if (await radio.isVisible({ timeout: 1000 }).catch(() => false)) {
        await radio.click().catch(() => {});
        break;
      }
    }

    await clickBtn(page, "Next");

    // Skip map steps — directly set hidden fields for a reasonable roof area
    // Average UK semi/detached has ~30-40sqm usable roof = ~8-10 panels
    await page.evaluate(() => {
      const areaField = document.querySelector('[name*="totalarea"], #h_totalarea, input[name="h_totalarea"]') as HTMLInputElement;
      if (areaField) areaField.value = "35";

      const panelField = document.querySelector('[name*="panelsneeded"], #h_panelsneeded, input[name="h_panelsneeded"]') as HTMLInputElement;
      if (panelField) panelField.value = "10";
    });

    // Try to skip to the package builder step
    for (let i = 0; i < 5; i++) {
      await clickBtn(page, "Next");
    }

    await page.waitForTimeout(3000);

    // Try to select a battery
    const batteryCheckbox = page.locator('input[name*="battery"], label:has-text("battery")').first();
    if (await batteryCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await batteryCheckbox.click().catch(() => {});
    }

    await page.waitForTimeout(2000);
    const screenshotPath = await takeScreenshot(page, "esesolar");
    const pageText = await getPageText(page);

    // Extract pricing from the page
    const prices = [...pageText.matchAll(/£([\d,]+(?:\.\d{2})?)/g)].map((m) => ({
      raw: m[0],
      value: parseFloat(m[1].replace(/,/g, "")),
    }));

    const savingsMatch = pageText.match(/(?:saving|save)\s*:?\s*£?([\d,]+)/i);
    const panelMatch = pageText.match(/(\d+)\s*x?\s*430\s*[wW]/);
    const fromPriceMatch = pageText.match(/From\s*:?\s*£?([\d,]+)/i);

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      panelWattage: 430,
      panelCount: panelMatch ? parseInt(panelMatch[1]) : null,
      fromPrice: fromPriceMatch ? parseFloat(fromPriceMatch[1].replace(/,/g, "")) : null,
      estimatedSavings: savingsMatch ? parseFloat(savingsMatch[1].replace(/,/g, "")) : null,
      allPrices: prices.filter((p) => p.value > 500),
      note: "ESE Solar shows estimated pricing — detailed quote requires contact from their team",
    };

    return {
      success: true,
      platform: "esesolar",
      rawData: { priceMatrix, pageText: pageText.slice(0, 3000) },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "esesolar-error").catch(() => null);
    return {
      success: false,
      platform: "esesolar",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function clickBtn(page: Page, text: string): Promise<void> {
  const btn = page.locator(`button:has-text("${text}"), input[value="${text}"], a:has-text("${text}")`).first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}
