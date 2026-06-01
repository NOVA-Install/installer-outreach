import type { ScraperResult, PropertyInput } from "./base";

/**
 * Eco Providers Solar Quote — API-based scraper (no browser needed).
 *
 * Discovered endpoint:
 *   POST /wp-content/themes/eco-providers-wp-v2/tpl-part/product-loop.php
 *   Body: quantity=6&energy_usage=Medium
 *   Returns: HTML with product cards containing data-* attributes
 *
 * Products have: data-id, data-name, data-price in the HTML.
 * No CSRF token needed — it's a plain POST to a PHP file.
 */

const PRICING_URL =
  "https://www.ecoproviders.co.uk/wp-content/themes/eco-providers-wp-v2/tpl-part/product-loop.php";

interface EcoProduct {
  id: string;
  name: string;
  price: number;
  billReduction: number | null;
  billSaving: number | null;
  monthlyPrice: number | null;
}

export async function scrapeEcoProvidersApi(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    const usage = mapUsage(property.annualElectricityUsage);

    // Scrape at multiple panel counts to get per-panel pricing
    const panelCounts = [6, 8, 10, 12];
    const allResults: Record<number, EcoProduct[]> = {};

    for (const qty of panelCounts) {
      const res = await fetch(PRICING_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Origin": "https://www.ecoproviders.co.uk",
          "Referer": "https://www.ecoproviders.co.uk/solar-fixed-quote-form/",
        },
        body: `quantity=${qty}&energy_usage=${usage}`,
      });

      if (!res.ok) continue;

      const html = await res.text();
      allResults[qty] = parseProductHtml(html);
    }

    // Use 10-panel results as the default, fallback to first available
    const defaultQty = allResults[10]?.length ? 10 : Object.keys(allResults).map(Number).find((k) => allResults[k]?.length) || 0;
    const products = allResults[defaultQty] || [];

    if (products.length === 0) {
      throw new Error("No products returned from pricing endpoint");
    }

    const isPanelOnly = (p: EcoProduct) =>
      !p.name.toLowerCase().includes("battery") &&
      !p.name.toLowerCase().includes("powerwall") &&
      !p.name.toLowerCase().includes("fox");

    // Build panel price points — price at each panel count (NOT linear)
    const panelPricePoints: Array<{ panelCount: number; panelOnlyPrice: number }> = [];
    const qtys = Object.keys(allResults).map(Number).sort((a, b) => a - b);
    for (const qty of qtys) {
      const po = allResults[qty]?.find(isPanelOnly);
      if (po) panelPricePoints.push({ panelCount: qty, panelOnlyPrice: po.price });
    }

    // Panel-only price for the default panel count
    const panelOnly = products.find(isPanelOnly);
    const panelOnlyPrice = panelOnly?.price || null;

    // Battery add-on costs = total package price - panel-only price at same count
    // Package prices from the API are TOTAL system prices (panels + battery + install)
    const batteryProducts = products.filter((p) => !isPanelOnly(p));

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      electricityUsage: usage,

      panelModel: "Aiko Neostar",
      panelWarrantyYears: 25,
      recommendedPanelCount: defaultQty,
      pricePerPanel: null, // Not linear — use panelPricePoints instead
      panelOnlyPrice,
      totalPrice: panelOnlyPrice, // Base price without battery

      annualSavings: panelOnly?.billSaving || null,
      monthlySavings: panelOnly?.monthlyPrice || null,

      // Battery options with add-on cost calculated
      batteryOptions: batteryProducts.map((p) => {
        const batteryCost = panelOnlyPrice ? p.price - panelOnlyPrice : null;
        return {
          name: p.name,
          model: p.name.replace(/^Aiko Neostar\s*\+?\s*/i, "").trim(),
          capacityKwh: extractCapacity(p.name),
          price: batteryCost, // Battery add-on cost (not total system price)
          totalPrice: p.price, // Full system price (panels + battery)
          monthlyPayment: p.monthlyPrice,
          billReductionPct: p.billReduction,
          annualSaving: p.billSaving,
        };
      }),

      // Panel price at each count (non-linear)
      panelPricePoints,

      // Full price table: every package at every panel count
      priceTable: Object.fromEntries(
        qtys.map((qty) => [
          qty,
          (allResults[qty] || []).map((p) => ({
            name: p.name,
            price: p.price,
            isBattery: !isPanelOnly(p),
            batteryCost: isPanelOnly(p) ? 0 : p.price - (allResults[qty]?.find(isPanelOnly)?.price || 0),
          })),
        ])
      ),
    };

    return {
      success: true,
      platform: "ecoproviders-api",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "ecoproviders-api",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseProductHtml(html: string): EcoProduct[] {
  const products: EcoProduct[] = [];

  // Extract data-id, data-name, data-price from product divs
  const productRegex = /data-id="([^"]*)"[^>]*data-name="([^"]*)"[^>]*data-price="([^"]*)"/g;
  let match;
  while ((match = productRegex.exec(html)) !== null) {
    products.push({
      id: match[1],
      name: match[2],
      price: parseInt(match[3], 10),
      billReduction: null,
      billSaving: null,
      monthlyPrice: null,
    });
  }

  // Also try the reverse order (data-name before data-id)
  if (products.length === 0) {
    const altRegex = /data-name="([^"]*)"[^>]*data-price="([^"]*)"/g;
    while ((match = altRegex.exec(html)) !== null) {
      products.push({
        id: String(products.length + 1),
        name: match[1],
        price: parseInt(match[2], 10),
        billReduction: null,
        billSaving: null,
        monthlyPrice: null,
      });
    }
  }

  // Extract bill reduction and savings from the HTML
  const reductionRegex = /(\d+)%\s*(?:bill\s*reduction|reduction)/gi;
  const savingsRegex = /£([\d,]+(?:\.\d{2})?)\s*(?:bill\s*saving|saving)/gi;
  const monthlyRegex = /£([\d,.]+)\s*(?:\/mo|per\s*month|monthly)/gi;

  const reductions = [...html.matchAll(reductionRegex)].map((m) => parseInt(m[1]));
  const savings = [...html.matchAll(savingsRegex)].map((m) => parseFloat(m[1].replace(/,/g, "")));
  const monthlies = [...html.matchAll(monthlyRegex)].map((m) => parseFloat(m[1].replace(/,/g, "")));

  // Assign to products in order
  products.forEach((p, i) => {
    if (reductions[i] != null) p.billReduction = reductions[i];
    if (savings[i] != null) p.billSaving = savings[i];
    if (monthlies[i] != null) p.monthlyPrice = monthlies[i];
  });

  return products;
}

function extractCapacity(name: string): number | null {
  if (name.toLowerCase().includes("panel only")) return 0;
  const match = name.match(/(\d+(?:\.\d+)?)\s*kWh/i);
  if (match) return parseFloat(match[1]);
  if (name.includes("Powerwall 3")) return 13.5;
  if (name.includes("EP6")) return 5.76;
  return null;
}

function mapUsage(kWh?: number): string {
  if (!kWh) return "Medium";
  if (kWh < 2500) return "Low";
  if (kWh > 4500) return "High";
  return "Medium";
}
