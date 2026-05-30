import type { ScraperResult, PropertyInput } from "./base";

/**
 * MakeMyHouseGreen scraper — direct platform API.
 *
 * MakeMyHouseGreen uses a Typeform quiz that redirects to their PHP platform
 * at platform.makemyhousegreen.com. We skip the Typeform entirely and hit
 * the platform directly with the required parameters.
 *
 * Flow discovered via research:
 *   Typeform → redirect to platform.makemyhousegreen.com/process_typef.php
 *   with query params: postcode, property_type, electricity_spend, etc.
 *   → platform renders results at /details?postcode=X
 *
 * Strategy: POST/GET the platform URL with required params and parse the HTML.
 */
export async function scrapeMakeMyHouseGreen(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
    };

    // Strategy 1: Try the platform details page directly
    const detailsUrl = `https://platform.makemyhousegreen.com/details?postcode=${encodeURIComponent(property.postcode)}`;
    const detailsRes = await fetch(detailsUrl, { headers, redirect: "follow" });

    let html = "";
    let success = false;

    if (detailsRes.ok) {
      html = await detailsRes.text();
      success = html.includes("solar") || html.includes("panel") || html.includes("£");
    }

    // Strategy 2: If direct access failed, try the Typeform processing endpoint
    if (!success) {
      const processParams = new URLSearchParams({
        postcode: property.postcode,
        property_type: mapPropertyType(property.propertyType),
        electricity_spend: mapElectricitySpend(property.currentElectricityBill),
        usage_profile: "medium",
      });

      const processUrl = `https://platform.makemyhousegreen.com/process_typef.php?${processParams}`;
      const processRes = await fetch(processUrl, { headers, redirect: "follow" });

      if (processRes.ok) {
        html = await processRes.text();
        success = html.includes("solar") || html.includes("panel") || html.includes("£");
      }
    }

    // Strategy 3: Try the main site's quote API if it exists
    if (!success) {
      const apiUrl = `https://makemyhousegreen.com/api/quote?postcode=${encodeURIComponent(property.postcode)}`;
      const apiRes = await fetch(apiUrl, { headers: { ...headers, "Accept": "application/json" } }).catch(() => null);

      if (apiRes?.ok) {
        const data = await apiRes.json();
        return {
          success: true,
          platform: "makemyhousegreen",
          rawData: { priceMatrix: data, source: "api" },
          screenshotPath: null,
          error: null,
        };
      }
    }

    if (!success || !html) {
      return {
        success: false,
        platform: "makemyhousegreen",
        rawData: null,
        screenshotPath: null,
        error: "Could not access platform — may require Typeform submission flow or browser automation",
      };
    }

    // Parse pricing from the HTML
    const prices = [...html.matchAll(/£([\d,]+(?:\.\d{2})?)/g)]
      .map((m) => ({ raw: m[0], value: parseFloat(m[1].replace(/,/g, "")) }))
      .filter((p) => p.value > 500);

    const panelMatch = html.match(/(\d+)\s*(?:solar\s*)?panels?/i);
    const savingsMatch = html.match(/save\s*£?([\d,]+)/i) || html.match(/savings?\s*(?:of\s*)?£?([\d,]+)/i);
    const kwMatch = html.match(/([\d.]+)\s*kW(?:p|h)?/i);

    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      panelCount: panelMatch ? parseInt(panelMatch[1]) : null,
      systemKw: kwMatch ? parseFloat(kwMatch[1]) : null,
      totalPrice: prices.length > 0 ? prices[0].value : null,
      annualSavings: savingsMatch ? parseFloat(savingsMatch[1].replace(/,/g, "")) : null,
      allPrices: prices,
      source: "platform-html",
    };

    return {
      success: true,
      platform: "makemyhousegreen",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "makemyhousegreen",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapPropertyType(type?: string): string {
  if (!type) return "Multi storey house";
  const l = type.toLowerCase();
  if (l.includes("bungalow") || l === "detached") return "Single storey house";
  return "Multi storey house";
}

function mapElectricitySpend(bill?: number): string {
  if (!bill) return "GBP60-120";
  if (bill < 720) return "<GBP60";
  if (bill < 1440) return "GBP60-120";
  if (bill < 1920) return "GBP120-160";
  return "GBP160+";
}
