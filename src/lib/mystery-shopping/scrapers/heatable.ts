import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";

/**
 * Heatable Solar Quote scraper — browser-based.
 *
 * Heatable uses Next.js with RSC streaming. The form is a 7-step wizard
 * that leads to a results page with pricing. No JSON API available.
 *
 * Form flow:
 *   1. Property type: House / Flat
 *   2. How many floors? 1 / 2 / 3 / 4+
 *   3. Energy usage timing: Half the day / All day
 *   4. Do you know annual usage? Yes / No
 *   5. If No: Low / Medium / High
 *   6. Address search
 *   7. Results with pricing
 */
export async function scrapeHeatable(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    await navigateAndSettle(page, url, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Dismiss cookies
    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Reject"), button:has-text("Got it")').first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Q1: Property type → House
    await clickOption(page, "House");

    // Q2: Floors → 2
    await clickOption(page, "2");

    // Q3: Usage timing → Half the day
    await clickOption(page, "Half the day");

    // Q4: Know annual usage? → No
    await clickOption(page, "No");

    // Q5: Usage level → Medium
    await clickOption(page, "Medium");

    // Q6: Address — enter postcode and select
    await page.waitForTimeout(2000);
    const addressInput = page.locator('input[type="text"], input[placeholder*="address" i], input[placeholder*="postcode" i]').first();
    if (await addressInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addressInput.fill(property.postcode);
      await page.waitForTimeout(2000);

      // Select first suggestion
      const suggestion = page.locator('[class*="suggestion"], [role="option"], [class*="dropdown"] li, [class*="result"] li').first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(2000);
    }

    // Click "See my price" or similar CTA
    await clickOption(page, "See my price");
    await clickOption(page, "Get my price");
    await clickOption(page, "See price");

    // Wait for results
    await page.waitForTimeout(10000);

    const screenshotPath = await takeScreenshot(page, "heatable");
    const pageText = await getPageText(page);

    // Extract pricing from results page
    const priceData = await page.evaluate(() => {
      const text = document.body.innerText;
      const prices = [...text.matchAll(/£([\d,]+(?:\.\d{2})?)/g)].map((m) => m[0]);
      const panels = text.match(/(\d+)\s*panels?/i);
      const kw = text.match(/([\d.]+)\s*kW(?:p|h)?/i);
      const savings = text.match(/£([\d,]+)\s*(?:savings?|saving|\/yr)/i);
      const monthly = text.match(/£([\d.]+)\s*(?:\/mo|per month|monthly)/i);

      return {
        prices,
        panelCount: panels ? parseInt(panels[1]) : null,
        systemKw: kw ? kw[1] : null,
        annualSavings: savings ? parseFloat(savings[1].replace(/,/g, "")) : null,
        monthlyPayment: monthly ? parseFloat(monthly[1]) : null,
        hasResults: text.includes("your price") || text.includes("Your price") || text.includes("quote") || prices.length > 2,
      };
    });

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      panelModel: null,
      panelWarrantyYears: null,
      recommendedPanelCount: priceData.panelCount,
      pricePerPanel: null,
      panelOnlyPrice: null,
      totalPrice: null as number | null,
      annualSavings: priceData.annualSavings,
      monthlySavings: priceData.monthlyPayment,
      batteryOptions: [] as Array<Record<string, unknown>>,
      _raw: priceData,
    };

    // Try to extract total price from the largest price on the page
    const numericPrices = priceData.prices
      .map((p) => parseFloat(p.replace(/[£,]/g, "")))
      .filter((p) => p > 1000)
      .sort((a, b) => b - a);
    if (numericPrices.length > 0) {
      priceMatrix.totalPrice = numericPrices[0];
    }

    return {
      success: true,
      platform: "heatable",
      rawData: { priceMatrix, pageText: pageText.slice(0, 5000), url: page.url() },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "heatable-error").catch(() => null);
    return {
      success: false,
      platform: "heatable",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function clickOption(page: Page, text: string): Promise<boolean> {
  // Try button, then heading, then any text match
  for (const sel of [
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
    `h1:has-text("${text}")`, `h2:has-text("${text}")`, `h3:has-text("${text}")`,
    `text="${text}"`,
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    }
  }
  return false;
}
