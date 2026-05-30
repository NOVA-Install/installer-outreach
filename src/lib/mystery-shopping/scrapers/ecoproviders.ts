import type { ScraperResult, PropertyInput } from "./base";

/**
 * Eco Providers scraper — HTML-based price extraction.
 *
 * Eco Providers has hardcoded prices in their page HTML for battery packages.
 * No form filling needed — just fetch the page and extract prices.
 *
 * Products (as of May 2026):
 *   - Tesla Powerwall 3: £7,995
 *   - FoxESS EP6: £3,800
 *   - Add-ons: myenergi zappi 7kW (£1,200), MyEnergi Eddi (£650)
 *
 * Note: This is a battery-only configurator, not full solar panels.
 */
export async function scrapeEcoProviders(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    const res = await fetch("https://www.ecoproviders.co.uk/solar-battery-quote-form/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html",
      },
    });

    if (!res.ok) {
      throw new Error(`Page fetch failed: ${res.status}`);
    }

    const html = await res.text();

    // Extract prices from the HTML
    // Eco Providers embeds prices in the page JS/HTML as data attributes or text
    const prices: Record<string, number> = {};

    // Look for price patterns in the HTML
    const pricePatterns = [
      { name: "Tesla Powerwall 3", pattern: /Tesla\s*Powerwall\s*3[^£]*£([\d,]+)/i },
      { name: "FoxESS EP6", pattern: /Fox\s*ESS?\s*EP6[^£]*£([\d,]+)/i },
      { name: "myenergi zappi", pattern: /zappi[^£]*£([\d,]+)/i },
      { name: "MyEnergi Eddi", pattern: /eddi[^£]*£([\d,]+)/i },
    ];

    for (const { name, pattern } of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        prices[name] = parseInt(match[1].replace(/,/g, ""));
      }
    }

    // Also try extracting from data attributes or JS objects
    const allPrices = [...html.matchAll(/(\d{1,2},?\d{3}(?:\.\d{2})?)/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, "")))
      .filter((p) => p >= 500 && p <= 20000);

    // Extract monthly payment patterns
    const monthlyPatterns = [...html.matchAll(/£([\d.]+)\s*(?:\/month|per month|monthly)/gi)];

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      productType: "battery-only",
      note: "Eco Providers sells battery storage packages, not full solar panel systems",

      batteryOptions: Object.entries(prices).map(([name, price]) => ({
        name,
        price,
        capacityKwh: name.includes("Powerwall") ? 13.5 : name.includes("EP6") ? 6 : null,
      })),

      addOns: Object.entries(prices)
        .filter(([name]) => name.includes("zappi") || name.includes("Eddi"))
        .map(([name, price]) => ({ name, price })),

      allDetectedPrices: [...new Set(allPrices)].sort((a, b) => a - b),
      monthlyPayments: monthlyPatterns.map((m) => `£${m[1]}/month`),
    };

    return {
      success: true,
      platform: "ecoproviders",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "ecoproviders",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
