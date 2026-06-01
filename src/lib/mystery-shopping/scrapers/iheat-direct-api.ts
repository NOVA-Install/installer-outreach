import type { ScraperResult, PropertyInput } from "./base";

/**
 * iHeat Solar Quote — API-based scraper (no browser needed).
 *
 * Discovered endpoints via network spy:
 *   1. Address lookup via Ideal Postcodes API
 *   2. POST /api/quote/solar — submit quiz answers, get quote reference
 *   3. POST /api/quote/results/solar — get full pricing (session-based)
 *   4. GET /api/finance/zopa — finance options
 *   5. GET /api/energy/tariff-rates — tariff data for savings calc
 *
 * The results endpoint is session-based — it uses cookies from the quote
 * submission to identify which quote to return. We maintain a cookie jar
 * across requests (same pattern as Boxt API scraper).
 */

const BASE_URL = "https://iheat.co.uk";

// Ideal Postcodes API key (public, embedded in iHeat's frontend)
const IDEAL_POSTCODES_KEY = "ak_jwf2zuu8NCEehxBIFoIv6tHFtr49U";

interface IheatProduct {
  id: number;
  title: string;
  brand: string;
  price_before_discount: number;
  price_after_discount: number;
  battery_capacity: number;
  battery_brand: string;
  battery_model: string;
  inverter_brand: string;
  inverter_model: string;
  inverter_output: number;
  panel_brand: string;
  panel_model: string;
  panel_wattage: number;
  panel_quantity: number;
  panel_warranty: number;
  inverter_warranty: number;
  battery_warranty: number;
  relations_enabled: unknown[];
  finance_options: unknown[];
  [key: string]: unknown;
}

export async function scrapeIheatApi(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    // Cookie jar for session management
    const cookieJar: string[] = [];

    function collectCookies(res: Response): void {
      const setCookies = res.headers.getSetCookie?.() || [];
      for (const c of setCookies) {
        const name = c.split("=")[0];
        const idx = cookieJar.findIndex((existing) => existing.startsWith(name + "="));
        if (idx >= 0) cookieJar[idx] = c.split(";")[0];
        else cookieJar.push(c.split(";")[0]);
      }
    }

    function getHeaders(extra?: Record<string, string>): Record<string, string> {
      return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/quote/solar`,
        "Cookie": cookieJar.join("; "),
        ...extra,
      };
    }

    // Step 0: Visit the page to get session cookies + CSRF token
    const sessionRes = await fetch(`${BASE_URL}/quote/solar`, {
      headers: getHeaders({ Accept: "text/html" }),
      redirect: "follow",
    });
    collectCookies(sessionRes);
    const pageHtml = await sessionRes.text();

    // Extract Laravel CSRF token from the page HTML
    const csrfMatch = pageHtml.match(/name="csrf-token"\s+content="([^"]+)"/);
    const xsrfCookie = cookieJar.find((c) => c.startsWith("XSRF-TOKEN="));
    const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.split("=")[1]) : null;

    // Add CSRF headers to all subsequent requests
    function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
      const h = getHeaders(extra);
      if (csrfMatch?.[1]) h["X-CSRF-TOKEN"] = csrfMatch[1];
      if (xsrfToken) h["X-XSRF-TOKEN"] = xsrfToken;
      h["X-Requested-With"] = "XMLHttpRequest";
      h["Accept"] = "application/json";
      return h;
    }

    // Step 1: Look up address via Ideal Postcodes
    const addrSearchRes = await fetch(
      `https://api.ideal-postcodes.co.uk/v1/autocomplete/addresses?api_key=${IDEAL_POSTCODES_KEY}&q=${encodeURIComponent(property.postcode)}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Referer": `${BASE_URL}/quote/solar` } }
    );
    const addrSearchData = await addrSearchRes.json();
    const suggestions = addrSearchData?.result?.hits || [];

    // Pick first non-flat suggestion
    const selectedAddr = suggestions.find(
      (s: Record<string, unknown>) => !String(s.suggestion || "").toLowerCase().includes("flat")
    ) || suggestions[0];

    if (!selectedAddr) {
      throw new Error(`No addresses found for postcode ${property.postcode}`);
    }

    // Get full address details
    const addrId = selectedAddr.id || selectedAddr.udprn;
    const addrDetailRes = await fetch(
      `https://api.ideal-postcodes.co.uk/v1/autocomplete/addresses/${addrId}/gbr?api_key=${IDEAL_POSTCODES_KEY}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Referer": `${BASE_URL}/quote/solar` } }
    );
    const addrDetail = (await addrDetailRes.json())?.result || {};

    // Step 2: Submit quotes at different consumption levels to get different panel counts
    // iHeat determines panel count from electricityEstimate — we can't request a specific count
    const consumptionLevels = [
      { elec: 1500, people: 2 },  // ~4-5 panels
      { elec: 2500, people: 3 },  // ~6-7 panels
      { elec: 3500, people: 4 },  // ~8-10 panels
      { elec: 5000, people: 5 },  // ~12-14 panels
    ];

    const allQuoteResults: Array<{ panelCount: number; products: IheatProduct[] }> = [];
    const customer = {
      address_line_1: addrDetail.line_1 || property.address,
      address_line_2: addrDetail.line_2 || "",
      address_line_3: addrDetail.line_3 || "",
      post_town: addrDetail.post_town || "",
      county: addrDetail.county || "",
      postcode: property.postcode,
      latitude: addrDetail.latitude || 0,
      longitude: addrDetail.longitude || 0,
    };

    for (const level of consumptionLevels) {
      // Need a fresh session for each quote (iHeat overwrites the previous one)
      const sessRes2 = await fetch(`${BASE_URL}/quote/solar`, {
        headers: getHeaders({ Accept: "text/html" }), redirect: "follow",
      });
      collectCookies(sessRes2);
      const html2 = await sessRes2.text();
      const csrf2 = html2.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1];
      const xsrf2 = cookieJar.find((c) => c.startsWith("XSRF-TOKEN="));
      const xsrfVal2 = xsrf2 ? decodeURIComponent(xsrf2.split("=")[1]) : null;

      function getQuoteHeaders(extra?: Record<string, string>): Record<string, string> {
        const h = getHeaders(extra);
        if (csrf2) h["X-CSRF-TOKEN"] = csrf2;
        if (xsrfVal2) h["X-XSRF-TOKEN"] = xsrfVal2;
        h["X-Requested-With"] = "XMLHttpRequest";
        h["Accept"] = "application/json";
        return h;
      }

      const quoteBody = {
        quoteType: "solar",
        postcode: property.postcode,
        homeType: mapPropertyType(property.propertyType),
        homeOwnership: "Homeowner",
        timeFrame: "Within 3 months",
        electricityKnown: "No",
        electricityAnnual: 0,
        peopleAtHome: level.people,
        electricVehicle: "No",
        timeAtHome: "Half Day",
        customer,
        landlord: "No",
        birdProofing: "No",
        electricityEstimate: level.elec,
        mapImage: "",
        saved: false,
      };

      const quoteRes = await fetch(`${BASE_URL}/api/quote/solar`, {
        method: "POST",
        headers: getQuoteHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(quoteBody),
      });
      collectCookies(quoteRes);

      if (!quoteRes.ok) {
        if (allQuoteResults.length === 0) {
          const errText = await quoteRes.text().catch(() => "");
          throw new Error(`Quote submission failed (${quoteRes.status}): ${errText.slice(0, 200)}`);
        }
        continue;
      }
      await quoteRes.json();

      // Get pricing results
      const resultsRes = await fetch(`${BASE_URL}/api/quote/results/solar`, {
        method: "POST",
        headers: getQuoteHeaders({ "Content-Type": "application/json" }),
      });
      collectCookies(resultsRes);

      if (!resultsRes.ok) continue;

      const resultsData = await resultsRes.json();
      const rawProducts = resultsData?.products || resultsData || [];

      const products: IheatProduct[] = rawProducts.map((p: Record<string, unknown>) => {
        const propScore = p.property_score as { min?: number; max?: number } | null;
        return {
          id: p.id as number,
          title: (p.product_title || p.title || "") as string,
          brand: (p.product_brand || p.brand || "") as string,
          price_before_discount: (p.price_before_discount ?? 0) as number,
          price_after_discount: (p.price_after_discount ?? 0) as number,
          battery_capacity: parseFloat(String(p.product_battery_capacity || 0)),
          battery_brand: (p.product_battery_brand || "") as string,
          battery_model: (p.product_battery_model || "") as string,
          inverter_brand: (p.product_inverter_brand || "") as string,
          inverter_model: (p.product_inverter_model || "") as string,
          inverter_output: parseFloat(String(p.product_inverter_output || 0)),
          panel_brand: (p.product_panel_brand || "") as string,
          panel_model: (p.product_panel_model || "") as string,
          panel_wattage: parseInt(String(p.product_panel_output || 0), 10),
          panel_quantity: propScore?.max || propScore?.min || 0,
          panel_warranty: parseInt(String(p.product_panel_warranty || 0), 10),
          inverter_warranty: parseInt(String(p.product_inverter_warranty || 0), 10),
          battery_warranty: parseInt(String(p.product_battery_warranty || 0), 10),
          relations_enabled: (p.relations_enabled || []) as unknown[],
          finance_options: (p.finance_options || []) as unknown[],
        };
      });

      if (products.length > 0) {
        allQuoteResults.push({ panelCount: products[0].panel_quantity, products });
      }

      // Brief delay between quotes
      await new Promise((r) => setTimeout(r, 500));
    }

    // Use the medium consumption result as the default
    const defaultResult = allQuoteResults.find((r) => r.panelCount >= 8) || allQuoteResults[0];
    if (!defaultResult) throw new Error("No quotes returned");
    const products = defaultResult.products;

    // Step 4: Get finance options (use last session headers)
    const financeRes = await fetch(`${BASE_URL}/api/finance/zopa`, {
      headers: getHeaders({ Accept: "application/json" }),
    });
    const financeData = financeRes.ok ? await financeRes.json() : [];

    // Find the 120-month finance factor for monthly payment calculation
    const longTermPlan = (Array.isArray(financeData) ? financeData : []).find(
      (f: Record<string, unknown>) => f.term === 120 || f.months === 120
    );
    const financeFactor = longTermPlan?.factor || 0.012927;

    // Helper to map products to our output format
    function mapProducts(prods: IheatProduct[]) {
      return prods
        .sort((a, b) => a.price_after_discount - b.price_after_discount)
        .map((p) => ({
          name: p.title || `${p.battery_brand} ${p.battery_model}`,
          model: `${p.battery_brand} ${p.battery_model}`.trim(),
          capacityKwh: p.battery_capacity,
          price: p.price_after_discount,
          panelCount: p.panel_quantity,
          panelModel: `${p.panel_brand} ${p.panel_wattage}W`,
          inverterModel: `${p.inverter_brand} ${p.inverter_model}`.trim(),
          inverterOutputKw: p.inverter_output,
          batteryWarranty: p.battery_warranty,
          monthlyPayment: Math.round(p.price_after_discount * financeFactor * 100) / 100,
          systemSizeKw: p.panel_quantity && p.panel_wattage
            ? Math.round(p.panel_quantity * p.panel_wattage) / 1000 : null,
        }));
    }

    // Panel-only price = cheapest package with 0 battery capacity
    const solarOnly = products.find((p) => p.battery_capacity === 0);
    const panelOnlyPrice = solarOnly?.price_after_discount || null;

    // Build panel price points from the solar-only package across consumption levels
    const panelPricePoints: Array<{ panelCount: number; price: number }> = [];
    for (const qr of allQuoteResults.sort((a, b) => a.panelCount - b.panelCount)) {
      const so = qr.products.find((p) => p.battery_capacity === 0);
      if (so) panelPricePoints.push({ panelCount: qr.panelCount, price: so.price_after_discount });
    }

    // Build full price table — every package at every panel count
    const priceTable: Record<string, Array<Record<string, unknown>>> = {};
    for (const qr of allQuoteResults) {
      priceTable[String(qr.panelCount)] = qr.products.map((p) => ({
        name: p.title || `${p.battery_brand} ${p.battery_model}`,
        price: p.price_after_discount,
        isBattery: p.battery_capacity > 0,
        batteryCost: panelOnlyPrice && p.battery_capacity > 0 ? p.price_after_discount - panelOnlyPrice : 0,
        batteryCapacityKwh: p.battery_capacity || null,
        batteryModel: p.battery_capacity > 0 ? `${p.battery_brand} ${p.battery_model}`.trim() : null,
      }));
    }

    // Build price matrix
    const priceMatrix = {
      address: customer.address_line_1,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",

      panelModel: products[0] ? `${products[0].panel_brand} ${products[0].panel_wattage}W` : null,
      panelWattage: products[0]?.panel_wattage || null,
      panelWarrantyYears: products[0]?.panel_warranty || null,
      recommendedPanelCount: products[0]?.panel_quantity || null,
      pricePerPanel: null,
      panelOnlyPrice,

      totalPrice: panelOnlyPrice || (products.length > 0
        ? Math.min(...products.map((p) => p.price_after_discount))
        : null),

      batteryOptions: mapProducts(products),
      panelPricePoints,
      priceTable,
      financeOptions: financeData,
    };

    return {
      success: true,
      platform: "iheat-api",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "iheat-api",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
