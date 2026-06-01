import type { ScraperResult, PropertyInput } from "./base";

/**
 * Stag Solar / Simplified Energy — API-based scraper.
 *
 * Unauthenticated POST, no cookies/keys needed.
 * Scrapes at multiple panel counts to build a full price table.
 *
 * Key insight: some packages labelled "Solar and Battery" are actually
 * solar-only (no battery product in the BOM). Detect by checking if
 * the products[] array contains a Battery or Combined Hybrid Inverter Battery.
 */

// Default config for Stag Solar — can be overridden via options
const DEFAULT_HOST = "https://quote.stagsolar.com";
const DEFAULT_TENANT_ID = "lRCr4ktLaMGx7wfIj7TFI";
const DEFAULT_QUOTE_ID = "1HYY7FC6SR";

export interface SimplifiedEnergyConfig {
  host: string;
  tenantId: string;
  quoteId: string;
}

/**
 * Create a scraper function for any Simplified Energy installer.
 * All Simplified Energy installers use the same API — just different host/tenant/quote IDs.
 */
export function createSimplifiedEnergyScraper(config: SimplifiedEnergyConfig) {
  return (page: unknown, url: string, property: PropertyInput) =>
    scrapeSimplifiedEnergyApi(page, url, property, config);
}

interface ParsedPackage {
  name: string;
  price: number;
  hasBattery: boolean;
  panelModel: string | null;
  panelWattage: number | null;
  panelCount: number;
  batteryModel: string | null;
  batteryCapacityKwh: number | null;
  inverterModel: string | null;
  products: Array<{ type: string; name: string; qty: number }>;
  pricingBreakdown: Array<{ item: string; cost: number }>;
}

/** Backwards-compatible export for Stag Solar specifically */
export async function scrapeStagSolarApi(
  page: unknown,
  url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  return scrapeSimplifiedEnergyApi(page, url, property, {
    host: DEFAULT_HOST,
    tenantId: DEFAULT_TENANT_ID,
    quoteId: DEFAULT_QUOTE_ID,
  });
}

async function scrapeSimplifiedEnergyApi(
  _page: unknown,
  _url: string,
  property: PropertyInput,
  config: SimplifiedEnergyConfig
): Promise<ScraperResult> {
  const BASE_URL = `https://${config.host.replace(/^https?:\/\//, "")}`;

  try {
    // Step 1: Look up address for coordinates
    const addrRes = await fetch(
      `${BASE_URL}/api/addresses/autocomplete?query=${encodeURIComponent(property.postcode)}`
    ).catch(() => null);

    let coords = { lng: -0.6, lat: 51.24 };
    let addressOneLiner = property.address;

    if (addrRes?.ok) {
      const addrData = await addrRes.json();
      const addresses = Array.isArray(addrData) ? addrData : addrData?.results || [];
      const selected = addresses.find(
        (a: Record<string, unknown>) => !String(a.addressOneLiner || "").toLowerCase().includes("flat")
      ) || addresses[0];
      if (selected) {
        addressOneLiner = selected.addressOneLiner || property.address;
        if (selected.geoPoint?.coordinates) {
          coords = { lng: selected.geoPoint.coordinates[0], lat: selected.geoPoint.coordinates[1] };
        }
      }
    }

    // Step 2: Scrape at multiple panel counts
    const panelCounts = [4, 6, 8, 10, 12, 14, 16];
    const allResults: Record<number, ParsedPackage[]> = {};

    for (const numPanels of panelCounts) {
      const body = buildRequestBody(property, addressOneLiner, coords, numPanels);

      const res = await fetch(
        `${BASE_URL}/api/solar-quote-v2/${config.tenantId}/${config.quoteId}/user-inputs`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        if (Object.keys(allResults).length === 0) {
          throw new Error(`Quote API failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
        }
        continue;
      }

      const data = await res.json();
      const rawPackages = data?.quote?.packages || [];
      allResults[numPanels] = rawPackages.map((pkg: Record<string, unknown>) => parsePackage(pkg, numPanels));

      await new Promise((r) => setTimeout(r, 500));
    }

    // Use 10-panel results as default
    const defaultQty = allResults[10]?.length ? 10 :
      Object.keys(allResults).map(Number).find((k) => allResults[k]?.length) || 0;
    const packages = allResults[defaultQty] || [];

    if (packages.length === 0) throw new Error("No packages returned");

    // Separate solar-only from battery packages
    const solarOnlyPackages = packages.filter((p) => !p.hasBattery);
    const batteryPackages = packages.filter((p) => p.hasBattery);

    // Use cheapest solar-only as baseline panel price
    const cheapestSolarOnly = solarOnlyPackages.sort((a, b) => a.price - b.price)[0];
    const panelOnlyPrice = cheapestSolarOnly?.price || null;

    // Panel price points across all counts (from cheapest solar-only package)
    const panelPricePoints: Array<{ panelCount: number; panelOnlyPrice: number; packageName: string }> = [];
    for (const qty of Object.keys(allResults).map(Number).sort((a, b) => a - b)) {
      const solarOnly = allResults[qty]
        ?.filter((p) => !p.hasBattery)
        .sort((a, b) => a.price - b.price)[0];
      if (solarOnly) {
        panelPricePoints.push({
          panelCount: qty,
          panelOnlyPrice: Math.round(solarOnly.price * 100) / 100,
          packageName: solarOnly.name,
        });
      }
    }

    // Panel info
    const firstPkg = packages[0];

    const priceMatrix = {
      address: addressOneLiner,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",

      panelModel: firstPkg.panelModel,
      panelWattage: firstPkg.panelWattage,
      panelWarrantyYears: null,
      recommendedPanelCount: defaultQty,
      pricePerPanel: null, // Non-linear
      panelOnlyPrice: panelOnlyPrice ? Math.round(panelOnlyPrice * 100) / 100 : null,
      totalPrice: panelOnlyPrice ? Math.round(panelOnlyPrice * 100) / 100 : null,

      // Solar-only packages (may be multiple with different inverters)
      solarOnlyPackages: solarOnlyPackages.map((p) => ({
        name: p.name,
        price: Math.round(p.price * 100) / 100,
        inverterModel: p.inverterModel,
        pricingBreakdown: p.pricingBreakdown,
      })),

      // Battery packages with add-on cost calculated
      batteryOptions: batteryPackages.map((p) => {
        const batteryCost = panelOnlyPrice != null ? Math.round((p.price - panelOnlyPrice) * 100) / 100 : null;
        return {
          name: p.name,
          model: p.batteryModel || p.name,
          capacityKwh: p.batteryCapacityKwh,
          price: batteryCost, // Battery add-on cost
          totalPrice: Math.round(p.price * 100) / 100, // Full system price
          inverterModel: p.inverterModel,
          pricingBreakdown: p.pricingBreakdown,
        };
      }),

      panelPricePoints,

      // Full price table: every package at every panel count
      priceTable: Object.fromEntries(
        Object.keys(allResults).map((qty) => [
          qty,
          (allResults[Number(qty)] || []).map((pkg) => {
            const solarBase = allResults[Number(qty)]
              ?.filter((p) => !p.hasBattery)
              .sort((a, b) => a.price - b.price)[0];
            return {
              name: pkg.name,
              price: Math.round(pkg.price * 100) / 100,
              isBattery: pkg.hasBattery,
              batteryCost: solarBase && pkg.hasBattery
                ? Math.round((pkg.price - solarBase.price) * 100) / 100
                : 0,
              batteryCapacityKwh: pkg.batteryCapacityKwh,
              batteryModel: pkg.batteryModel,
            };
          }),
        ])
      ),
    };

    return {
      success: true,
      platform: "simplified-energy",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "simplified-energy",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parsePackage(raw: Record<string, unknown>, numPanels: number): ParsedPackage {
  const products = ((raw.products as Array<Record<string, unknown>>) || []).map((p) => {
    const prod = p.product as Record<string, unknown>;
    return {
      type: (prod.type || "") as string,
      name: `${prod.manufacturer || ""} ${prod.manufacturerProductName || ""}`.trim(),
      qty: (p.quantity || 1) as number,
      peakPowerW: prod.peakPowerW as number | undefined,
    };
  });

  const panel = products.find((p) => p.type === "PV Panel");
  const battery = products.find((p) => p.type === "Battery" || p.type === "Combined Hybrid Inverter Battery");
  const inverter = products.find((p) =>
    p.type === "Hybrid Inverter" || p.type === "String Inverter" || p.type === "Combined Hybrid Inverter Battery"
  );

  // Parse battery capacity from product name
  let batteryCapacityKwh: number | null = null;
  if (battery) {
    const capMatch = battery.name.match(/([\d.]+)\s*kWh/i);
    if (capMatch) {
      batteryCapacityKwh = parseFloat(capMatch[1]);
    } else if (battery.name.includes("Powerwall 3")) {
      batteryCapacityKwh = 13.5;
    } else {
      // Try parsing numbers that look like capacity (e.g. "Giv-Bat 5.2")
      const numMatch = battery.name.match(/(\d+\.?\d*)\s*(?:Gen|$)/i);
      if (numMatch && parseFloat(numMatch[1]) < 50) {
        batteryCapacityKwh = parseFloat(numMatch[1]);
      }
    }
  }

  const pricingResults = (raw.pricingResult as Record<string, unknown>)?.results as Array<Record<string, unknown>> || [];

  return {
    name: (raw.name || "") as string,
    price: (raw.price || 0) as number,
    hasBattery: !!battery,
    panelModel: panel ? `${panel.name}` : null,
    panelWattage: panel?.peakPowerW || null,
    panelCount: panel?.qty || numPanels,
    batteryModel: battery?.name || null,
    batteryCapacityKwh,
    inverterModel: inverter?.name || null,
    products: products.map((p) => ({ type: p.type, name: p.name, qty: p.qty })),
    pricingBreakdown: pricingResults.map((r) => ({
      item: (r.blockName || "") as string,
      cost: (r.result || 0) as number,
    })),
  };
}

function buildRequestBody(
  property: PropertyInput,
  addressOneLiner: string,
  coords: { lng: number; lat: number },
  numPanels: number
) {
  return {
    elecUsageProfile: "More in morning and evening",
    elecType: "Domestic Single Phase",
    batteryPreference: "No preference",
    batteryCapacityAuto: true,
    packagesSort: "Price (Low to High)",
    elecCostType: "annual-cost",
    dailyStandingChargePence: 54,
    annElecConsumption: property.annualElectricityUsage || 3500,
    annElecCost: property.currentElectricityBill || 1200,
    unitElecCostPence: 24.86,
    showOrthoImage: false,
    panelPolygonsOrCount: "polygons",
    drawingOrManual: "manual",
    quoteAddress: {
      addressOneLiner,
      streetName: property.address,
      city: "",
      stateRegion: "",
      country: "England",
      postcode: property.postcode,
      geoPoint: { type: "Point", coordinates: [coords.lng, coords.lat] },
    },
    exactPin: { type: "Point", coordinates: [coords.lng, coords.lat] },
    roofs: [{
      id: "scraper-roof-1",
      pitch: "Normal pitch",
      direction: mapRoofDirection(property.roofOrientation),
      material: "Concrete Tile",
      shading: false,
      numFloors: 2,
      numPanels,
      longestSideM: 5,
    }],
    saved: false,
  };
}

function mapRoofDirection(orientation?: string): string {
  if (!orientation) return "South";
  const l = orientation.toLowerCase();
  if (l.includes("south-east") || l.includes("se")) return "South East";
  if (l.includes("south-west") || l.includes("sw")) return "South West";
  if (l.includes("south")) return "South";
  if (l.includes("east")) return "East";
  if (l.includes("west")) return "West";
  if (l.includes("north")) return "North";
  return "South";
}
