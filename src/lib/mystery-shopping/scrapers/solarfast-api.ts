import type { ScraperResult, PropertyInput } from "./base";

/**
 * Wickes/SolarFast Solar Price Estimator — API-based scraper.
 * The estimator is hosted at online.solarfast.co.uk and embedded in Wickes.
 *
 * API endpoints:
 *   POST /api/package          → Get available solar packages for property
 *   POST /api/package/pricing  → Get price for specific package + quantities
 *   POST /api/package/projections → Savings projections
 *
 * No browser or session cookies needed — the API is open.
 */

const BASE_URL = "https://online.solarfast.co.uk";

interface SolarFastPackage {
  id: string;
  name: string;
  panelProduct: { name: string; wattage: number };
  batteryProduct?: { name: string; capacityKwh: number } | null;
  inverterProduct?: { name: string } | null;
  minPanels: number;
  maxPanels: number;
  recommendedPanels: number;
  totalSalePrice: number;
  [key: string]: unknown;
}

interface SolarFastPricing {
  totalSalePrice: number;
  panelCount: number;
  batteryCount: number;
  [key: string]: unknown;
}

export async function scrapeSolarFastApi(
  _page: unknown,
  _url: string,
  property: PropertyInput
): Promise<ScraperResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Origin": "https://www.wickes.co.uk",
      "Referer": "https://www.wickes.co.uk/",
    };

    // Step 1: Get available packages for this property
    const packageBody = {
      postcode: property.postcode,
      propertyType: mapPropertyType(property.propertyType),
      roofType: mapRoofType(property.roofType),
      consumption: property.annualElectricityUsage || 4000,
      shading: false,
    };

    const pkgRes = await fetch(`${BASE_URL}/api/package`, {
      method: "POST",
      headers,
      body: JSON.stringify(packageBody),
    });

    if (!pkgRes.ok) {
      const errText = await pkgRes.text().catch(() => "");
      throw new Error(`Package API failed (${pkgRes.status}): ${errText.slice(0, 200)}`);
    }

    const packages: SolarFastPackage[] = await pkgRes.json();

    if (!packages || packages.length === 0) {
      throw new Error("No packages returned — postcode may not be in coverage area");
    }

    // Step 2: For each package, get pricing at different panel counts
    const packageDetails = [];

    for (const pkg of packages) {
      // Get pricing at recommended panel count
      const pricingBody = {
        packageId: pkg.id,
        panelCount: pkg.recommendedPanels,
        batteryCount: pkg.batteryProduct ? 1 : 0,
      };

      const priceRes = await fetch(`${BASE_URL}/api/package/pricing`, {
        method: "POST",
        headers,
        body: JSON.stringify(pricingBody),
      });

      let pricing: SolarFastPricing | null = null;
      if (priceRes.ok) {
        pricing = await priceRes.json();
      }

      // Get pricing with one fewer panel to calculate incremental price
      let pricingMinus: SolarFastPricing | null = null;
      if (pkg.recommendedPanels > pkg.minPanels) {
        const minusRes = await fetch(`${BASE_URL}/api/package/pricing`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...pricingBody, panelCount: pkg.recommendedPanels - 1 }),
        });
        if (minusRes.ok) {
          pricingMinus = await minusRes.json();
        }
      }

      // Get savings projections
      let projections: Record<string, unknown> | null = null;
      const projBody = {
        annualConsumptionKwh: property.annualElectricityUsage || 4000,
        unitRatePerKwPence: 10,
        systemSalePrice: pricing?.totalSalePrice || pkg.totalSalePrice,
        occupancyArchetype: "InMostOfDay",
        panelProduct: pkg.panelProduct?.name,
        shading: false,
        postcode: property.postcode,
      };

      const projRes = await fetch(`${BASE_URL}/api/package/projections`, {
        method: "POST",
        headers,
        body: JSON.stringify(projBody),
      });
      if (projRes.ok) {
        projections = await projRes.json();
      }

      const pricePerPanel =
        pricing && pricingMinus
          ? pricing.totalSalePrice - pricingMinus.totalSalePrice
          : null;

      // Extract product details from nested fields or top-level
      const panelModel = pkg.panelProduct?.name || (pkg as Record<string, unknown>).panelProductName as string || null;
      const panelWattage = pkg.panelProduct?.wattage || (pkg as Record<string, unknown>).panelWattage as number || null;
      const batteryModel = pkg.batteryProduct?.name || (pkg as Record<string, unknown>).batteryProductName as string || null;
      const batteryKwh = pkg.batteryProduct?.capacityKwh || (pkg as Record<string, unknown>).batteryCapacityKwh as number || null;

      packageDetails.push({
        id: pkg.id,
        name: pkg.name,
        panelModel,
        panelWattage,
        batteryModel,
        batteryCapacityKwh: batteryKwh,
        inverterModel: pkg.inverterProduct?.name || null,
        minPanels: pkg.minPanels,
        maxPanels: pkg.maxPanels,
        recommendedPanels: pkg.recommendedPanels,
        totalPrice: pricing?.totalSalePrice ?? pkg.totalSalePrice,
        pricePerPanel,
        projections,
        _raw: pkg, // Keep raw data for debugging
      });
    }

    // Build the price matrix
    const recommended = packageDetails[0];
    const priceMatrix = {
      address: property.address,
      postcode: property.postcode,
      roofType: property.roofType || "pitched",

      // Panel info from the first/recommended package
      panelModel: recommended?.panelModel || null,
      panelWarrantyYears: null,
      recommendedPanelCount: recommended?.recommendedPanels || null,
      pricePerPanel: recommended?.pricePerPanel || null,

      // Pricing
      panelOnlyPrice: null as number | null, // SolarFast bundles panels+inverter
      totalPrice: recommended?.totalPrice || null,

      // Savings
      annualSavings: (recommended?.projections as Record<string, unknown>)?.yearOneSaving as number | null ?? null,
      monthlySavings: null as number | null,

      // All packages as "battery options" equivalent
      batteryOptions: packageDetails.map((p) => ({
        name: p.name,
        model: p.batteryModel || "No battery",
        capacityKwh: p.batteryCapacityKwh,
        price: p.totalPrice,
        panelModel: p.panelModel,
        panelWattage: p.panelWattage,
        recommendedPanels: p.recommendedPanels,
        pricePerPanel: p.pricePerPanel,
        projections: p.projections,
      })),

      // Raw package data
      _packages: packageDetails,
    };

    if (priceMatrix.annualSavings) {
      priceMatrix.monthlySavings = Math.round(priceMatrix.annualSavings / 12);
    }

    return {
      success: true,
      platform: "solarfast",
      rawData: { priceMatrix },
      screenshotPath: null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      platform: "solarfast",
      rawData: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapPropertyType(type?: string): string {
  if (!type) return "Detached";
  const l = type.toLowerCase();
  if (l.includes("semi")) return "SemiDetached";
  if (l.includes("terrace")) return "Terraced";
  if (l.includes("bungalow")) return "Bungalow";
  if (l.includes("flat")) return "Flat";
  return "Detached";
}

function mapRoofType(type?: string): string {
  if (!type) return "Pitched";
  return type.toLowerCase() === "flat" ? "Flat" : "Pitched";
}
