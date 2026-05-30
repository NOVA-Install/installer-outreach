import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";

/**
 * Generic calculator/quote page scraper.
 *
 * Used as a fallback when no platform-specific scraper exists.
 * Strategy: navigate to the page, try common form interactions,
 * capture a screenshot + full text, and let AI do the heavy lifting.
 */
export async function scrapeGeneric(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    await navigateAndSettle(page, url);

    // Try to fill any postcode fields
    const postcodeInputs = page.locator(
      'input[placeholder*="postcode" i], input[name*="postcode" i], input[id*="postcode" i], input[aria-label*="postcode" i]'
    );
    const postcodeCount = await postcodeInputs.count();
    if (postcodeCount > 0) {
      await postcodeInputs.first().fill(property.postcode);
      await page.waitForTimeout(500);
    }

    // Try to fill email fields (some calculators require it)
    const emailInputs = page.locator(
      'input[type="email"], input[name*="email" i], input[placeholder*="email" i]'
    );
    if (await emailInputs.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      // Use a throwaway email — in production this would be the burner email
      await emailInputs.first().fill("quote@example.com");
    }

    // Try to fill name fields
    const nameInput = page.locator(
      'input[name*="name" i]:not([name*="company"]):not([type="email"]):not([type="tel"])'
    ).first();
    if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nameInput.fill("Sarah Jones");
    }

    // Try to fill phone fields
    const phoneInput = page.locator(
      'input[type="tel"], input[name*="phone" i], input[name*="tel" i], input[placeholder*="phone" i]'
    ).first();
    if (await phoneInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await phoneInput.fill("07700900000");
    }

    // Try property type selects
    if (property.propertyType) {
      await trySelectOption(page, ["property", "house", "dwelling"], property.propertyType);
    }

    // Try roof type selects
    if (property.roofType) {
      await trySelectOption(page, ["roof"], property.roofType);
    }

    // Try electricity bill/usage inputs
    if (property.currentElectricityBill) {
      const billInput = page.locator(
        'input[name*="bill" i], input[name*="electricity" i], input[name*="spend" i], input[placeholder*="bill" i]'
      ).first();
      if (await billInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await billInput.fill(String(property.currentElectricityBill));
      }
    }

    // Click any prominent CTA buttons
    const ctaSelectors = [
      'button:has-text("Get Quote")',
      'button:has-text("Calculate")',
      'button:has-text("Get Price")',
      'button:has-text("See Results")',
      'button:has-text("Submit")',
      'button:has-text("Next")',
      'input[type="submit"]',
    ];
    for (const sel of ctaSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(3000);
        break;
      }
    }

    // Wait for any dynamic content
    await page.waitForTimeout(2000);

    const screenshotPath = await takeScreenshot(page, "generic");
    const pageText = await getPageText(page);

    // Extract any prices from the page
    const priceData = await page.evaluate(() => {
      const text = document.body.innerText;
      const priceRegex = /£[\d,]+(?:\.\d{2})?/g;
      const prices = text.match(priceRegex) || [];
      const kwRegex = /(\d+(?:\.\d+)?)\s*kW(?:h|p)?/gi;
      const kwMatches = text.match(kwRegex) || [];
      const panelRegex = /(\d+)\s*(?:solar\s+)?panels?/i;
      const panelMatch = text.match(panelRegex);
      return {
        detectedPrices: prices,
        detectedKw: kwMatches,
        detectedPanelCount: panelMatch ? panelMatch[1] : null,
      };
    });

    return {
      success: true,
      platform: "generic",
      rawData: {
        pageText,
        url: page.url(),
        ...priceData,
      },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "generic-error").catch(() => null);
    return {
      success: false,
      platform: "generic",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Try to find and select an option in a <select> element.
 */
async function trySelectOption(
  page: Page,
  nameHints: string[],
  value: string
): Promise<void> {
  for (const hint of nameHints) {
    const select = page.locator(
      `select[name*="${hint}" i], select[id*="${hint}" i]`
    ).first();
    if (await select.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Try to find matching option
      const options = await select.locator("option").allTextContents();
      const match = options.find(
        (o) => o.toLowerCase().includes(value.toLowerCase())
      );
      if (match) {
        await select.selectOption({ label: match });
      }
      return;
    }
  }
}
