import type { Page } from "playwright";
import type { ScraperResult, PropertyInput } from "./base";
import { navigateAndSettle, takeScreenshot, getPageText } from "./base";

/**
 * iHeat Solar Quote scraper — browser-based.
 *
 * iHeat shows instant pricing but the results page is server-rendered HTML,
 * not a JSON API. We need Playwright to:
 *   1. Navigate through the multi-step form (8-9 questions)
 *   2. Wait for the results page to render
 *   3. Extract pricing from the HTML
 *
 * Form flow:
 *   1. Address lookup (via Ideal Postcodes API)
 *   2. Map confirmation
 *   3. Homeowner/renter/landlord
 *   4. Property type (detached/semi/terraced/bungalow/apartment)
 *   5. How soon to install
 *   6. Yearly electricity usage (kWh or skip)
 *   7. People in home (1-2 / 3-4 / 5+)
 *   8. Electric vehicle? (yes/no)
 *   9. When at home? (all day / half day / hardly)
 *   10. Bird protection? (yes/no)
 *
 * Results page: /quote/solar/results/{quoteRef}
 * Shows multiple brand options with panel counts, battery sizes, and prices.
 */
export async function scrapeIheat(
  page: Page,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    await navigateAndSettle(page, url, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Dismiss cookie banner
    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Got it"), [id*="cookie"] button').first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Step 1: Address lookup
    const addressInput = page.locator('input[placeholder*="address" i], input[placeholder*="postcode" i], input[type="search"], input[type="text"]').first();
    await addressInput.waitFor({ state: "visible", timeout: 10000 });
    await addressInput.fill(property.postcode);
    await page.waitForTimeout(2000);

    // Select first suggestion from autocomplete
    const suggestion = page.locator('[class*="suggestion"], [class*="autocomplete"] li, [role="option"], [class*="dropdown"] li, [class*="result"]').first();
    if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
      await suggestion.click();
      await page.waitForTimeout(2000);
    } else {
      // Try pressing Enter
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
    }

    // Step 2: Map confirmation — look for a "Confirm" or "Next" button
    await clickNextButton(page);

    // Steps 3-10: Answer questions by clicking matching options
    const answers: Record<string, string[]> = {
      homeowner: ["Homeowner", "homeowner", "I own"],
      propertyType: [
        mapPropertyTypeIheat(property.propertyType),
        "Detached", "Semi-Detached", "Terraced",
      ],
      timeline: ["Within 3 months", "ASAP", "Unsure"],
      usage: ["No", "no"], // Skip the "do you know usage" step
      people: ["3-4", "1-2"],
      ev: ["No", "no"],
      atHome: ["Half the day", "All day"],
      birdProtection: ["No", "no"],
    };

    // Walk through steps — try each answer set, click what's visible
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(1500);

      // Check if we've reached the results page
      if (page.url().includes("/results")) break;

      // Try clicking relevant answer options
      let clicked = false;
      for (const answerSet of Object.values(answers)) {
        for (const answer of answerSet) {
          const option = page.locator(`text="${answer}"`).first();
          if (await option.isVisible({ timeout: 500 }).catch(() => false)) {
            await option.click().catch(() => {});
            clicked = true;
            await page.waitForTimeout(1000);
            break;
          }
        }
        if (clicked) break;
      }

      // If no answer matched, try clicking Next/Continue
      if (!clicked) {
        await clickNextButton(page);
      }
    }

    // Wait for results page
    await page.waitForTimeout(5000);

    // Take screenshot and extract data
    const screenshotPath = await takeScreenshot(page, "iheat");
    const pageText = await getPageText(page);

    // Extract pricing from the results page HTML
    const priceData = await page.evaluate(() => {
      const text = document.body.innerText;
      const packages: Array<{
        brand: string;
        panels: number | null;
        panelWattage: number | null;
        batteryKwh: number | null;
        totalPrice: number | null;
        monthlyPrice: number | null;
        annualSavings: number | null;
        paybackYears: number | null;
      }> = [];

      // Look for price patterns
      const priceMatches = [...text.matchAll(/£([\d,]+(?:\.\d{2})?)/g)];
      const panelMatches = [...text.matchAll(/(\d+)\s*x?\s*panels?/gi)];
      const wattageMatches = [...text.matchAll(/(\d+)\s*[Ww]/g)];
      const batteryMatches = [...text.matchAll(/([\d.]+)\s*kWh/gi)];
      const savingsMatches = [...text.matchAll(/£([\d,]+)\s*(?:\/yr|per year|annual|yearly)/gi)];
      const paybackMatches = [...text.matchAll(/([\d.]+)\s*(?:yr|year)\s*payback/gi)];

      // Look for brand names
      const brands = ["Duracell", "Fox ESS", "Alpha ESS", "Tesla", "Hanchu", "Sigenergy", "Longi", "Aiko", "JA Solar"];

      // Try to find structured package cards
      const cards = document.querySelectorAll('[class*="card"], [class*="package"], [class*="option"], [class*="product"]');
      if (cards.length > 0) {
        cards.forEach((card) => {
          const cardText = (card as HTMLElement).innerText || "";
          const brand = brands.find((b) => cardText.includes(b)) || null;
          if (!brand) return;

          const price = cardText.match(/£([\d,]+(?:\.\d{2})?)/);
          const panels = cardText.match(/(\d+)\s*x?\s*panels?/i);
          const wattage = cardText.match(/(\d+)\s*[Ww]/);
          const battery = cardText.match(/([\d.]+)\s*kWh/i);
          const savings = cardText.match(/£([\d,]+)\s*(?:\/yr|savings)/i);
          const payback = cardText.match(/([\d.]+)\s*(?:yr|year)/i);
          const monthly = cardText.match(/£([\d.]+)\s*(?:\/mo|per month|monthly)/i);

          packages.push({
            brand,
            panels: panels ? parseInt(panels[1]) : null,
            panelWattage: wattage ? parseInt(wattage[1]) : null,
            batteryKwh: battery ? parseFloat(battery[1]) : null,
            totalPrice: price ? parseFloat(price[1].replace(/,/g, "")) : null,
            monthlyPrice: monthly ? parseFloat(monthly[1]) : null,
            annualSavings: savings ? parseFloat(savings[1].replace(/,/g, "")) : null,
            paybackYears: payback ? parseFloat(payback[1]) : null,
          });
        });
      }

      return {
        packages,
        allPrices: priceMatches.map((m) => m[0]),
        url: window.location.href,
        hasResults: text.includes("your quote") || text.includes("Your Quote") || text.includes("package") || packages.length > 0,
      };
    });

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      panelModel: null as string | null,
      panelWarrantyYears: null,
      recommendedPanelCount: null as number | null,
      pricePerPanel: null,
      panelOnlyPrice: null,
      totalPrice: null as number | null,
      batteryOptions: priceData.packages.map((p) => ({
        name: `${p.brand} ${p.panels ? p.panels + "x" : ""} ${p.panelWattage ? p.panelWattage + "W" : ""}`.trim(),
        model: p.brand,
        capacityKwh: p.batteryKwh,
        price: p.totalPrice,
        monthlyPrice: p.monthlyPrice,
        annualSavings: p.annualSavings,
        paybackYears: p.paybackYears,
        panels: p.panels,
        panelWattage: p.panelWattage,
      })),
      _raw: priceData,
    };

    if (priceData.packages.length > 0) {
      const first = priceData.packages[0];
      priceMatrix.panelModel = first.brand ? `${first.brand} ${first.panelWattage || ""}W` : null;
      priceMatrix.recommendedPanelCount = first.panels;
      priceMatrix.totalPrice = first.totalPrice;
    }

    return {
      success: true,
      platform: "iheat",
      rawData: { priceMatrix, pageText: pageText.slice(0, 5000), url: page.url() },
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

async function clickNextButton(page: Page): Promise<void> {
  const nextSelectors = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Confirm")',
    'button:has-text("Get Quote")',
    'button:has-text("See Results")',
    'button[type="submit"]',
    '[class*="next"]',
  ];
  for (const sel of nextSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
  }
}

function mapPropertyTypeIheat(type?: string): string {
  if (!type) return "Detached";
  const l = type.toLowerCase();
  if (l.includes("semi")) return "Semi-Detached";
  if (l.includes("terrace")) return "Terraced";
  if (l.includes("bungalow")) return "Bungalow";
  if (l.includes("flat")) return "Apartment";
  return "Detached";
}
