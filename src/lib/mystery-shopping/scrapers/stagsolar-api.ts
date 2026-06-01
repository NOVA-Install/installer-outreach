import type { ScraperResult, PropertyInput } from "./base";

/**
 * Stag Solar / Simplified Energy — API-based scraper.
 *
 * Unauthenticated POST to:
 *   POST https://quote.stagsolar.com/api/solar-quote-v2/{tenantId}/{quoteId}/user-inputs
 *
 * No cookies, no API key, no session required.
 * Returns full pricing with packages[], products[], and pricingBreakdown.
 *
 * The "Unlock pricing" contact form is a soft UI gate — prices are returned
 * before submitting contact details. We use saved: false to skip it.
 */

const BASE_URL = "https://quote.stagsolar.com";
const TENANT_ID = "lRCr4ktLaMGx7wfIj7TFI";
const QUOTE_ID = "1HYY7FC6SR"; // Reusable draft ID

interface StagProduct {
  product: {
    type: string;
    manufacturer: string;
    manufacturerProductName: string;
    peakPowerW?: number;
    costExcTax?: number;
  };
  quantity: number;
}

interface StagPackage {
  id: string;
  name: string;
  packageType: string;
  price: number;
  priceVatApplied: boolean;
  vatRate: number;
  products: StagProduct[];
  pricingResult?: {
    results: Array<{
      blockName: string;
      result: number;
    }>;
  };
  solarDesignInsight?: Record<string, unknown>;
}

export async function scrapeStagSolarApi(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    // Step 1: Look up address to get coordinates
    const addrRes = await fetch(
      `${BASE_URL}/api/addresses/autocomplete?query=${encodeURIComponent(property.postcode)}`,
      { headers: { "Content-Type": "application/json" } }
    );
    let coords = { lng: -0.6, lat: 51.24 }; // Default fallback
    let addressOneLiner = property.address;
    let udprn = 0;
    let uprn = "";

    if (addrRes.ok) {
      const addrData = await addrRes.json();
      const addresses = Array.isArray(addrData) ? addrData : addrData?.results || [];
      // Pick first non-flat address
      const selected = addresses.find(
        (a: Record<string, unknown>) => !String(a.addressOneLiner || a.address || "").toLowerCase().includes("flat")
      ) || addresses[0];

      if (selected) {
        addressOneLiner = selected.addressOneLiner || selected.address || property.address;
        udprn = selected.udprn || 0;
        uprn = selected.uprn || "";
        if (selected.geoPoint?.coordinates) {
          coords = { lng: selected.geoPoint.coordinates[0], lat: selected.geoPoint.coordinates[1] };
        } else if (selected.longitude && selected.latitude) {
          coords = { lng: selected.longitude, lat: selected.latitude };
        }
      }
    }

    // Step 2: Build the quote request body
    const panelCounts = [6, 8, 10, 12, 14];
    const allResults: Record<number, StagPackage[]> = {};

    for (const numPanels of panelCounts) {
      const body = {
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
          udprn,
          uprn,
          postcode: property.postcode,
          geoPoint: { type: "Point", coordinates: [coords.lng, coords.lat] },
        },
        exactPin: { type: "Point", coordinates: [coords.lng, coords.lat] },
        roofs: [
          {
            id: "scraper-roof-1",
            pitch: "Normal pitch",
            direction: mapRoofDirection(property.roofOrientation),
            material: "Concrete Tile",
            shading: false,
            numFloors: 2,
            numPanels: numPanels,
            longestSideM: 5,
          },
        ],
        saved: false, // Don't trigger email
      };

      const res = await fetch(
        `${BASE_URL}/api/solar-quote-v2/${TENANT_ID}/${QUOTE_ID}/user-inputs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        if (numPanels === panelCounts[0]) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Quote API failed (${res.status}): ${errText.slice(0, 200)}`);
        }
        continue;
      }

      const data = await res.json();
      const packages: StagPackage[] = data?.quote?.packages || [];
      allResults[numPanels] = packages;

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    }

    // Use 10-panel results as default
    const defaultQty = allResults[10]?.length ? 10 : Object.keys(allResults).map(Number).find((k) => allResults[k]?.length) || 0;
    const packages = allResults[defaultQty] || [];

    if (packages.length === 0) {
      throw new Error("No packages returned");
    }

    // Extract panel info from first package
    const firstPkg = packages[0];
    const panelProduct = firstPkg.products.find((p) => p.product.type === "PV Panel");
    const panelModel = panelProduct
      ? `${panelProduct.product.manufacturer} ${panelProduct.product.manufacturerProductName}`
      : null;
    const panelWattage = panelProduct?.product.peakPowerW || null;

    // Find solar-only package for panel-only price
    const solarOnly = packages.find((p) => p.name.toLowerCase().includes("solar only"));
    const panelOnlyPrice = solarOnly?.price || null;

    // Build panel price points from solar-only package across panel counts
    const panelPricePoints: Array<{ panelCount: number; panelOnlyPrice: number }> = [];
    for (const qty of Object.keys(allResults).map(Number).sort((a, b) => a - b)) {
      const so = allResults[qty]?.find((p) => p.name.toLowerCase().includes("solar only"));
      if (so) panelPricePoints.push({ panelCount: qty, panelOnlyPrice: so.price });
    }

    // Build battery options from packages (excluding solar-only)
    const batteryPackages = packages.filter((p) => !p.name.toLowerCase().includes("solar only"));

    const priceMatrix = {
      address: addressOneLiner,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",

      panelModel,
      panelWattage,
      panelWarrantyYears: null,
      recommendedPanelCount: defaultQty,
      pricePerPanel: null, // Non-linear, use panelPricePoints
      panelOnlyPrice,
      totalPrice: panelOnlyPrice, // Base without battery

      batteryOptions: batteryPackages.map((pkg) => {
        const battery = pkg.products.find((p) =>
          ["Battery", "Combined Hybrid Inverter Battery"].includes(p.product.type)
        );
        const inverter = pkg.products.find((p) =>
          ["Hybrid Inverter", "String Inverter", "Combined Hybrid Inverter Battery"].includes(p.product.type)
        );
        const batteryCost = panelOnlyPrice ? pkg.price - panelOnlyPrice : null;

        return {
          name: pkg.name,
          model: battery
            ? `${battery.product.manufacturer} ${battery.product.manufacturerProductName}`
            : pkg.name,
          capacityKwh: null as number | null, // Not directly in the API — parse from name
          price: batteryCost, // Battery add-on cost
          totalPrice: pkg.price, // Full system price
          inverterModel: inverter
            ? `${inverter.product.manufacturer} ${inverter.product.manufacturerProductName}`
            : null,
          pricingBreakdown: pkg.pricingResult?.results?.map((r) => ({
            item: r.blockName,
            cost: r.result,
          })) || [],
        };
      }),

      panelPricePoints,

      // Full price table
      priceTable: Object.fromEntries(
        Object.keys(allResults).map((qty) => [
          qty,
          (allResults[Number(qty)] || []).map((pkg) => {
            const so = allResults[Number(qty)]?.find((p) => p.name.toLowerCase().includes("solar only"));
            return {
              name: pkg.name,
              price: pkg.price,
              isBattery: !pkg.name.toLowerCase().includes("solar only"),
              batteryCost: so ? pkg.price - so.price : 0,
            };
          }),
        ])
      ),
    };

    return {
      success: true,
      platform: "stagsolar-api",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "stagsolar-api",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
