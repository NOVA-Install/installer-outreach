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

      // The pricing endpoint returns either a plain number or an object with totalSalePrice
      let pricingValue: number | null = null;
      if (priceRes.ok) {
        const pricingRaw = await priceRes.json();
        pricingValue = typeof pricingRaw === "number" ? pricingRaw
          : pricingRaw?.totalSalePrice ?? null;
      }

      // Get pricing with one fewer panel to calculate incremental price
      let pricingMinusValue: number | null = null;
      if (pkg.recommendedPanels > pkg.minPanels) {
        const minusRes = await fetch(`${BASE_URL}/api/package/pricing`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...pricingBody, panelCount: pkg.recommendedPanels - 1 }),
        });
        if (minusRes.ok) {
          const minusRaw = await minusRes.json();
          pricingMinusValue = typeof minusRaw === "number" ? minusRaw
            : minusRaw?.totalSalePrice ?? null;
        }
      }

      // Use the pricing endpoint value (correct) or fall back to package listing (stale)
      const actualPrice = pricingValue ?? pkg.totalSalePrice;

      // Get savings projections
      let projections: Record<string, unknown> | null = null;
      const projBody = {
        annualConsumptionKwh: property.annualElectricityUsage || 4000,
        unitRatePerKwPence: 10,
        systemSalePrice: actualPrice,
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
        pricingValue != null && pricingMinusValue != null
          ? pricingValue - pricingMinusValue
          : null;

      // Extract product details from nested arrays
      const raw = pkg as Record<string, unknown>;
      const panels = raw.panels as Array<{ product: { name: string; pmax: number; warranty: number }; quantity: number }> | undefined;
      const batteries = raw.batteries as Array<{ product: { name: string; nominalCapacity: number; usableCapacity: number; warranty: number }; quantity: number }> | undefined;
      const inverters = raw.inverters as Array<{ product: { name: string; usableCapacity: number; warranty: number }; quantity: number }> | undefined;

      const panel = panels?.[0];
      const battery = batteries?.[0];
      const inverter = inverters?.[0];

      const panelWatts = panel?.product?.pmax ? Math.round(panel.product.pmax * 1000) : null;
      const systemSizeW = raw.systemSize as number | undefined;
      const annualGenKwh = raw.averageGenerationAnnualKwh as number | undefined;
      const emi = raw.emi as string | undefined;

      packageDetails.push({
        id: pkg.id,
        name: pkg.name,
        panelModel: panel?.product?.name || null,
        panelWattage: panelWatts,
        panelWarranty: panel?.product?.warranty || null,
        panelCount: panel?.quantity || null,
        batteryModel: battery?.product?.name || null,
        batteryCapacityKwh: battery?.product?.usableCapacity || battery?.product?.nominalCapacity || null,
        batteryWarranty: battery?.product?.warranty || null,
        inverterModel: inverter?.product?.name || null,
        inverterCapacityKwh: inverter?.product?.usableCapacity || null,
        systemSizeKw: systemSizeW ? systemSizeW / 1000 : null,
        annualGenerationKwh: annualGenKwh || null,
        monthlyPayment: emi ? parseFloat(emi) : null,
        minPanels: pkg.minPanels,
        maxPanels: pkg.maxPanels,
        recommendedPanels: pkg.recommendedPanels || panel?.quantity || null,
        totalPrice: actualPrice,
        pricePerPanel,
        projections,
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
      panelWarrantyYears: recommended?.panelWarranty || null,
      recommendedPanelCount: recommended?.recommendedPanels || recommended?.panelCount || null,
      pricePerPanel: recommended?.pricePerPanel || null,

      // Pricing
      panelOnlyPrice: null as number | null,
      totalPrice: recommended?.totalPrice || null,
      monthlyPayment: recommended?.monthlyPayment || null,

      // System info
      systemSizeKw: recommended?.systemSizeKw || null,
      annualGenerationKwh: recommended?.annualGenerationKwh || null,

      // Savings
      annualSavings: (recommended?.projections as Record<string, unknown>)?.yearOneSaving as number | null ?? null,
      monthlySavings: null as number | null,

      // All packages
      batteryOptions: packageDetails.map((p) => ({
        name: p.name,
        model: p.batteryModel || "Panels only",
        capacityKwh: p.batteryCapacityKwh,
        price: p.totalPrice,
        panelModel: p.panelModel,
        panelWattage: p.panelWattage,
        panelCount: p.panelCount,
        panelWarranty: p.panelWarranty,
        batteryWarranty: p.batteryWarranty,
        inverterModel: p.inverterModel,
        systemSizeKw: p.systemSizeKw,
        annualGenerationKwh: p.annualGenerationKwh,
        monthlyPayment: p.monthlyPayment,
        recommendedPanels: p.recommendedPanels,
        pricePerPanel: p.pricePerPanel,
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
