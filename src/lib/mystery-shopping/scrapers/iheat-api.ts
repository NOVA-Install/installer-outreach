import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { takeScreenshot } from "./base";

/**
 * iHeat Solar Quote scraper — browser-based.
 *
 * Flow (tested May 2026):
 *   1. Address autocomplete (Ideal Postcodes API)
 *   2. Map confirmation — Continue button at bottom of satellite view
 *   3. Homeowner / Renting / Landlord → Homeowner
 *   4. Property type → Detached/Semi/Terraced/Bungalow/Apartment
 *   5. How soon to install → Within 3 months
 *   6. Know yearly usage? → No
 *   7. People in home → 3-4
 *   8. Electric vehicle? → No
 *   9. When at home? → Half the day
 *   10. Bird protection? → No (may auto-skip)
 *   → Results page at /quote/solar/results/{ref} with pricing cards
 *   → "Save your quote" popup appears first — dismiss with "Continue without saving"
 *
 * Click strategy: Options are large card divs, not buttons.
 * Use div.filter({ hasText: /^Answer$/ }) to find cards, then mouse.click
 * at their center coordinates.
 */
export async function scrapeIheat(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Dismiss cookies
    await page.locator('button:has-text("Deny")').first().click().catch(() => {});
    await page.waitForTimeout(1000);

    // Step 1: Address autocomplete
    await page.locator('input[placeholder*="Start typing"]').first().fill(property.postcode);
    await page.waitForTimeout(2000);

    // Select first non-flat address from dropdown
    const addrItems = page.locator("li").filter({ hasNotText: /[Ff]lat/ });
    const firstAddr = addrItems.first();
    if (await firstAddr.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstAddr.click();
    }
    await page.waitForTimeout(3000);

    // Step 2: Map confirmation — find the visible Continue button
    const contBox = await page.evaluate(() => {
      for (const btn of document.querySelectorAll("button")) {
        if (btn.textContent?.trim() === "Continue") {
          const r = btn.getBoundingClientRect();
          if (r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });
    if (contBox) await page.mouse.click(contBox.x, contBox.y);
    await page.waitForTimeout(3000);

    // Steps 3-10: Answer questions
    const answers = [
      "Homeowner",
      mapPropertyType(property.propertyType),
      "Within 3 months",
      "No",            // know usage?
      mapPeople(property.bedrooms),
      "No",            // EV?
      "Half the day",  // at home?
      "No",            // bird protection?
    ];

    for (const answer of answers) {
      if (page.url().includes("/results")) break;
      await clickCard(page, answer);
      await page.waitForTimeout(2500);
    }

    // Wait for results page to load
    for (let i = 0; i < 30; i++) {
      if (page.url().includes("/results")) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(3000);

    // Dismiss "Save your quote" popup
    const dismissBtn = page.locator('text="Continue without saving"');
    if (await dismissBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dismissBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Extract pricing from results page
    const screenshotPath = await takeScreenshot(page, "iheat");

    const priceData = await page.evaluate(() => {
      const text = document.body.innerText;

      // Annual savings
      const savingsMatch = text.match(/£([\d,]+)\s*annual bill savings/i);
      const annualSavings = savingsMatch ? parseFloat(savingsMatch[1].replace(/,/g, "")) : null;

      // Energy reduction percentage
      const reductionMatch = text.match(/(\d+)%\s*energy bill reduction/i);
      const reductionPct = reductionMatch ? parseInt(reductionMatch[1]) : null;

      // Usage info
      const usageMatch = text.match(/([\d,]+)\s*kWh annual usage/i);
      const annualUsage = usageMatch ? parseInt(usageMatch[1].replace(/,/g, "")) : null;

      // Find package cards — look for price + brand patterns
      const packages: Array<{
        brand: string;
        totalPrice: number | null;
        monthlyPrice: number | null;
        annualSavings: number | null;
      }> = [];

      // iHeat shows brand-grouped packages with prices
      const brands = ["Duracell Energy", "Fox ESS", "Alpha ESS", "Tesla", "Hanchu", "Sigenergy"];
      const allPrices = [...text.matchAll(/£([\d,]+(?:\.\d{2})?)/g)].map((m) => ({
        raw: m[0],
        value: parseFloat(m[1].replace(/,/g, "")),
        index: m.index || 0,
      }));

      // Try to extract from structured cards
      const cards = document.querySelectorAll('[class*="card"], [class*="package"], [class*="product"]');
      cards.forEach((card) => {
        const cardText = (card as HTMLElement).innerText || "";
        const brand = brands.find((b) => cardText.includes(b));
        if (!brand) return;

        const priceMatch = cardText.match(/£([\d,]+(?:\.\d{2})?)/);
        const monthlyMatch = cardText.match(/£([\d.]+)\s*(?:\/mo|per month|monthly)/i);
        const savMatch = cardText.match(/£([\d,]+)\s*(?:\/yr|savings|annual)/i);

        // Avoid duplicates
        if (packages.some((p) => p.brand === brand)) return;

        packages.push({
          brand,
          totalPrice: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null,
          monthlyPrice: monthlyMatch ? parseFloat(monthlyMatch[1]) : null,
          annualSavings: savMatch ? parseFloat(savMatch[1].replace(/,/g, "")) : null,
        });
      });

      return {
        annualSavings,
        reductionPct,
        annualUsage,
        packages,
        allPrices: allPrices.filter((p) => p.value > 100).map((p) => p.value),
      };
    });

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      panelModel: null as string | null,
      panelWarrantyYears: null,
      recommendedPanelCount: null,
      pricePerPanel: null,
      panelOnlyPrice: null,
      totalPrice: null as number | null,
      annualSavings: priceData.annualSavings,
      monthlySavings: priceData.annualSavings ? Math.round(priceData.annualSavings / 12) : null,
      reductionPct: priceData.reductionPct,
      batteryOptions: priceData.packages.map((p) => ({
        name: p.brand,
        price: p.totalPrice,
        monthlyPrice: p.monthlyPrice,
        capacityKwh: null,
      })),
      allPrices: priceData.allPrices,
      resultsUrl: page.url(),
    };

    // Set total price from cheapest package
    const validPrices = priceData.allPrices.filter((p) => p > 2000 && p < 30000).sort((a, b) => a - b);
    if (validPrices.length > 0) {
      priceMatrix.totalPrice = validPrices[0];
    }

    return {
      success: true,
      platform: "iheat",
      rawData: { priceMatrix },
      screenshotPath,
      error: null,
    };
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, "iheat-error").catch(() => null);
    return {
      success: false,
      platform: "iheat",
      rawData: null,
      screenshotPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Click a card option by finding the div with exact text match and clicking at its center */
async function clickCard(page: Page, text: string): Promise<boolean> {
  const cards = page.locator("div").filter({ hasText: new RegExp(`^${escapeRegex(text)}$`) });
  const count = await cards.count();

  for (let i = count - 1; i >= 0; i--) {
    const card = cards.nth(i);
    if (await card.isVisible({ timeout: 300 }).catch(() => false)) {
      const box = await card.boundingBox();
      if (box && box.height > 40) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      }
    }
  }

  // Fallback: getByText with force
  try {
    await page.getByText(text, { exact: true }).last().click({ force: true, timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapPropertyType(type?: string): string {
  if (!type) return "Detached";
  const l = type.toLowerCase();
  if (l.includes("semi")) return "Semi-Detached";
  if (l.includes("terrace")) return "Terraced";
  if (l.includes("bungalow")) return "Bungalow";
  if (l.includes("flat")) return "Apartment";
  return "Detached";
}

function mapPeople(bedrooms?: number): string {
  if (!bedrooms || bedrooms <= 2) return "1-2";
  if (bedrooms <= 4) return "3-4";
  return "5+";
}
