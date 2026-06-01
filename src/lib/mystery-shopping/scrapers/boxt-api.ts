import type { ScraperResult, PropertyInput } from "./base";

/**
 * BOXT Solar Configurator — API-based scraper.
 *
 * Instead of clicking through the UI with Playwright, this calls Boxt's
 * internal Next.js API endpoints directly:
 *
 *   1. GET  /api/_next/addresses?term={postcode}     → address list
 *   2. GET  /api/_next/addresses?id={addressId}       → full address
 *   3. GET  /api/_next/csrf-token                     → CSRF token
 *   4. POST /api/_next/solar/configurator/initialise  → full pricing basket
 *   5. GET  /api/_next/solar/screenings/basket?id=... → all available packages
 *
 * Advantages: instant (no browser needed), reliable, gets ALL price
 * configurations in one call, no overlay/click issues.
 */

const BASE_URL = "https://app.boxt.co.uk";

interface BoxtAddress {
  id: string;
  label: string;
  address?: string;
}

interface BoxtBasketItem {
  id: string;
  itemableId: string;
  packageType: string;
  units: number;
  financeOptions?: {
    interestBearing: number[];
    interestFree: number[];
  };
}

interface BoxtBasketMeta {
  annualSavingsInPence: number;
  monthlySavingsInPence: number;
  totalPriceInPence: number;
  originalTotalPriceInPence: number;
  panelsOnlyPriceInPence: number;
  panelsOnlyOriginalPriceInPence: number;
  recommendedBatteryCapacityInKwh: number;
  recommendedNumberOfPanels: number;
  recommendedPriceInPence: number;
  [key: string]: unknown;
}

interface BoxtAvailablePackage {
  id: string;
  name: string;
  packageType: string;
  displayable: boolean;
  summary: string;
  capacityInKwh?: number;
  priceInPence?: number;
  [key: string]: unknown;
}

interface BoxtInitialiseResponse {
  screeningId: string;
  basket: {
    items: BoxtBasketItem[];
    meta: BoxtBasketMeta;
    additionalPackages: BoxtAvailablePackage[] | null;
    availablePackages: BoxtAvailablePackage[] | null;
    discounts: unknown[];
  };
}

interface BoxtBasketResponse {
  basket: {
    items: BoxtBasketItem[];
    meta: BoxtBasketMeta;
    additionalPackages: BoxtAvailablePackage[] | null;
    availablePackages: BoxtAvailablePackage[] | null;
    discounts: unknown[];
  };
}

/**
 * Scrape Boxt pricing via their internal API.
 * No browser needed — pure HTTP requests.
 */
export async function scrapeBoxtApi(
  _page: unknown, // unused — kept for interface compatibility with browser scraper
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    // Step 0: Build a session by collecting cookies across requests.
    // Boxt's CSRF validation requires the session cookie from the page load.
    const cookieJar: string[] = [];

    function collectCookies(res: Response): void {
      const setCookies = res.headers.getSetCookie?.() || [];
      for (const c of setCookies) {
        const name = c.split("=")[0];
        // Replace existing cookie with same name
        const idx = cookieJar.findIndex((existing) => existing.startsWith(name + "="));
        if (idx >= 0) cookieJar[idx] = c.split(";")[0];
        else cookieJar.push(c.split(";")[0]);
      }
    }

    function getHeaders(extra?: Record<string, string>): Record<string, string> {
      return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/solar/configurator`,
        "Cookie": cookieJar.join("; "),
        ...extra,
      };
    }

    // Visit the page to get session cookies
    const sessionRes = await fetch(`${BASE_URL}/solar/configurator`, {
      headers: getHeaders({ "Accept": "text/html" }),
      redirect: "follow",
    });
    collectCookies(sessionRes);
    // Consume body to release the connection
    await sessionRes.text();

    const sessionHeaders = getHeaders();

    // Step 1: Look up addresses for this postcode
    const addressesRes = await fetch(
      `${BASE_URL}/api/_next/addresses?term=${encodeURIComponent(property.postcode)}`,
      { headers: getHeaders() }
    );
    collectCookies(addressesRes);
    if (!addressesRes.ok) {
      throw new Error(`Address lookup failed: ${addressesRes.status}`);
    }
    const addresses: BoxtAddress[] = await addressesRes.json();

    if (!addresses || addresses.length === 0) {
      throw new Error(`No addresses found for postcode ${property.postcode}`);
    }

    // Pick first non-flat address
    const selectedAddress = addresses.find(
      (a) => !a.label?.toLowerCase().includes("flat")
    ) || addresses[0];

    // Step 2: Get full address details
    const addressDetailRes = await fetch(
      `${BASE_URL}/api/_next/addresses?id=${encodeURIComponent(selectedAddress.id)}`,
      { headers: getHeaders() }
    );
    collectCookies(addressDetailRes);
    const addressDetail = await addressDetailRes.json();

    // Build formatted address string from the structured fields
    // The real request uses format: "20 Duchy Road, Harrogate, North Yorkshire, HG1 2ER"
    const parts = [
      addressDetail?.addressLine1,
      addressDetail?.addressLine2,
      addressDetail?.addressLine3,
      addressDetail?.city,
      addressDetail?.county,
      addressDetail?.postcode,
    ].filter(Boolean);
    const fullAddress = parts.join(", ") || selectedAddress.label || property.address;

    // Step 3: Get CSRF token (tied to the session cookie)
    const csrfRes = await fetch(`${BASE_URL}/api/_next/csrf-token`, {
      headers: getHeaders(),
    });
    collectCookies(csrfRes);
    const csrfData = await csrfRes.json();
    const csrfToken = csrfData?.csrfToken || csrfData?.token || "";

    // Step 4: Initialise the configurator — this returns the full pricing basket
    const initHeaders = getHeaders({ "Content-Type": "application/json" });
    if (csrfToken) {
      initHeaders["x-csrf-token"] = csrfToken;
    }

    const initRes = await fetch(
      `${BASE_URL}/api/_next/solar/configurator/initialise`,
      {
        method: "POST",
        headers: initHeaders,
        body: JSON.stringify({

          address: fullAddress,
          screenerAnswers: {
            propertyOwnership: "homeowner",
            roofType: property.roofType === "flat" ? "flat" : "pitched",
            electricityUsage: mapUsage(property.annualElectricityUsage),
            solarReason: "lower-bills",
          },
        }),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text().catch(() => "");
      throw new Error(`Initialise failed (${initRes.status}): ${errText.slice(0, 200)}`);
    }

    const initData: BoxtInitialiseResponse = await initRes.json();
    const { screeningId, basket: initialBasket } = initData;

    collectCookies(initRes);

    // Step 5: Get the full basket with all available packages
    const basketRes = await fetch(
      `${BASE_URL}/api/_next/solar/screenings/basket?id=${screeningId}&productType=solar`,
      { headers: getHeaders() }
    );
    const basketData: BoxtBasketResponse = basketRes.ok ? await basketRes.json() : { basket: initialBasket };
    const basket = basketData.basket;

    // Build the price matrix from API data
    const meta = basket.meta || initialBasket.meta;
    const availablePackages = basket.availablePackages || initialBasket.availablePackages || [];

    // Extract panel info from items
    const panelItem = (basket.items || initialBasket.items).find((i) => i.packageType === "panel");
    const batteryItem = (basket.items || initialBasket.items).find((i) => i.packageType === "battery");
    const inverterItem = (basket.items || initialBasket.items).find((i) => i.packageType === "inverter");

    // Separate available packages by type
    const panelPackages = availablePackages.filter((p) => p.packageType === "panel");
    const batteryPackages = availablePackages.filter((p) => p.packageType === "battery");
    const inverterPackages = availablePackages.filter((p) => p.packageType === "inverter");

    // Extract panel model name and per-panel price from available packages
    const panelPkg = panelPackages[0];
    const panelModel = panelPkg?.name?.replace(/\s*panels?\s*$/i, "").trim() || null;
    const marginalPricePerPanel = panelPkg?.priceInPence ? panelPkg.priceInPence / 100 : null;

    const priceMatrix = {
      address: fullAddress,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",
      electricityUsage: mapUsage(property.annualElectricityUsage),
      screeningId,

      // Panel info
      panelModel,
      panelWarrantyYears: 25, // Boxt standard
      recommendedPanelCount: meta.recommendedNumberOfPanels,
      panelOnlyPrice: meta.panelsOnlyPriceInPence / 100,
      panelOnlyOriginalPrice: meta.panelsOnlyOriginalPriceInPence / 100,
      totalPrice: meta.totalPriceInPence / 100,
      originalTotalPrice: meta.originalTotalPriceInPence / 100,
      recommendedPrice: meta.recommendedPriceInPence / 100,

      // Incremental price per panel (from API — the cost to add/remove one panel)
      pricePerPanel: marginalPricePerPanel,

      // Savings
      annualSavings: meta.annualSavingsInPence / 100,
      monthlySavings: meta.monthlySavingsInPence / 100,
      recommendedBatteryCapacityKwh: meta.recommendedBatteryCapacityInKwh,

      // Current basket items (the recommended config)
      currentItems: {
        panel: panelItem ? { id: panelItem.itemableId, units: panelItem.units } : null,
        battery: batteryItem ? { id: batteryItem.itemableId, units: batteryItem.units } : null,
        inverter: inverterItem ? { id: inverterItem.itemableId, units: inverterItem.units } : null,
      },

      // All available panel options
      panelOptions: panelPackages.map((p) => ({
        id: p.id,
        name: p.name,
        pricePerUnit: p.priceInPence ? p.priceInPence / 100 : null,
        ...extractPackageDetails(p),
      })),

      // All available battery options
      batteryOptions: batteryPackages.map((p) => ({
        id: p.id,
        name: p.name,
        capacityKwh: extractCapacityKwh(p),
        price: p.priceInPence ? p.priceInPence / 100 : null,
        ...extractPackageDetails(p),
      })),

      // All available inverter options
      inverterOptions: inverterPackages.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.priceInPence ? p.priceInPence / 100 : null,
        ...extractPackageDetails(p),
      })),

      // Discounts
      discounts: basket.discounts || [],

      // Raw API response for debugging
      _raw: {
        meta,
        itemCount: (basket.items || []).length,
        availablePackageCount: availablePackages.length,
      },
    };

    return {
      success: true,
      platform: "boxt-api",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "boxt-api",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapUsage(kWh?: number): string {
  if (!kWh) return "medium";
  if (kWh < 2500) return "low";
  if (kWh > 4500) return "high";
  return "medium";
}

function extractCapacityKwh(pkg: BoxtAvailablePackage): number | null {
  // Try direct field
  if (pkg.capacityInKwh) return pkg.capacityInKwh;
  // Try mainProduct.description (e.g. "5.3kWh")
  const mainProduct = (pkg as Record<string, unknown>).mainProduct as Record<string, string> | undefined;
  if (mainProduct?.description) {
    const match = mainProduct.description.match(/([\d.]+)\s*kWh/i);
    if (match) return parseFloat(match[1]);
  }
  // Try parsing from name (e.g. "Sunsynk W5.3" → 5.3)
  const nameMatch = pkg.name.match(/W([\d.]+)/);
  if (nameMatch) return parseFloat(nameMatch[1]);
  return null;
}

function extractPackageDetails(pkg: BoxtAvailablePackage): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  // Copy any interesting fields that aren't in the standard interface
  for (const [key, value] of Object.entries(pkg)) {
    if (!["id", "name", "packageType", "displayable", "summary", "priceInPence", "capacityInKwh"].includes(key)) {
      details[key] = value;
    }
  }
  return details;
}
