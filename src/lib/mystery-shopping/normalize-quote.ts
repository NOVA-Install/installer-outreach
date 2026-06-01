/**
 * Normalizes price matrix data from different scrapers into a standard format.
 *
 * Each scraper returns data in a slightly different shape. This layer
 * transforms them all into a consistent format for the UI.
 */

export interface NormalizedPackage {
  /** Package/brand name, e.g. "Fox ESS: Solar and Battery" */
  name: string;
  /** Fully installed system price (GBP) */
  systemPrice: number;
  /** Battery add-on cost vs solar-only (GBP), null if unknown */
  batteryAddOnCost: number | null;

  // Panel details
  panelModel: string | null;
  panelWattageW: number | null;
  panelCount: number | null;
  systemSizeKw: number | null;

  // Battery details
  batteryModel: string | null;
  batteryCapacityKwh: number | null;
  hasBattery: boolean;

  // Inverter details
  inverterModel: string | null;

  // Finance
  monthlyPayment: number | null;
}

export interface NormalizedQuote {
  installerName: string;
  installerId: number;
  scrapedAt: string;
  postcode: string;

  // Default panel info (from recommended config)
  defaultPanelModel: string | null;
  defaultPanelWattageW: number | null;
  defaultPanelCount: number | null;
  panelOnlyPrice: number | null;

  // All packages sorted by price
  packages: NormalizedPackage[];

  // Panel price at different counts (where available)
  panelPricePoints: Array<{ panelCount: number; price: number }>;

  // Full price table — packages at each panel count (where available)
  priceTable: Record<number, NormalizedPackage[]>;
}

/**
 * Normalize a raw price matrix from any scraper into a standard format.
 */
export function normalizeQuote(
  installerId: number,
  installerName: string,
  scrapedAt: string,
  rawMatrix: Record<string, unknown>
): NormalizedQuote {
  const postcode = (rawMatrix.postcode || "") as string;
  const batteryOptions = (rawMatrix.batteryOptions || []) as Array<Record<string, unknown>>;
  const solarOnlyPackages = (rawMatrix.solarOnlyPackages || []) as Array<Record<string, unknown>>;
  const panelOnlyPrice = rawMatrix.panelOnlyPrice as number | null;

  // Also check priceTable for per-panel-count data
  const priceTable = rawMatrix.priceTable as Record<string, Array<Record<string, unknown>>> | undefined;

  // Extract default panel info from the top-level matrix
  const topPanelModel = rawMatrix.panelModel as string | null;
  const topPanelWattage = extractWattage(topPanelModel, rawMatrix.panelWattage as number | undefined);
  const topPanelCount = rawMatrix.recommendedPanelCount as number | null;

  // Detect if packages are full systems (Wickes/iHeat) or battery add-ons (Boxt/EcoProviders/Stag)
  const isFullSystem = batteryOptions.some(
    (b) => b.panelModel || b.panelCount || b.systemSizeKw
  );

  // Normalize each package
  const packages: NormalizedPackage[] = batteryOptions.map((b) => {
    const bName = (b.name || b.model || "Unknown") as string;

    // Panel info — from package if full system, from top-level if add-on
    const pkgPanelModel = (b.panelModel as string) || topPanelModel;
    const pkgPanelWattage = extractWattage(
      pkgPanelModel,
      (b.panelWattage as number) || topPanelWattage || undefined
    );
    const pkgPanelCount = (b.panelCount as number) || (b.recommendedPanels as number) || topPanelCount;

    // System size
    const systemSizeKw = (b.systemSizeKw as number)
      || (pkgPanelCount && pkgPanelWattage ? Math.round(pkgPanelCount * pkgPanelWattage) / 1000 : null);

    // Battery
    const batteryModel = (b.model as string) || (b.name as string) || null;
    const capacityKwh = (b.capacityKwh as number) || null;
    const hasBattery = !!capacityKwh && capacityKwh > 0;

    // Pricing
    let systemPrice: number;
    let batteryAddOnCost: number | null;

    if (isFullSystem) {
      // Full system: price IS the system price
      systemPrice = ((b.totalPrice ?? b.price) as number) || 0;
      batteryAddOnCost = null;
    } else if (b.totalPrice != null) {
      // Has explicit total (Eco Providers, Stag Solar)
      systemPrice = b.totalPrice as number;
      batteryAddOnCost = (b.price as number) || null;
    } else {
      // Battery add-on only (Boxt) — calculate system price
      const addOnCost = (b.price as number) || 0;
      const bundleDiscount = ((rawMatrix.originalTotalPrice as number) && (rawMatrix.totalPrice as number))
        ? (rawMatrix.originalTotalPrice as number) - (rawMatrix.totalPrice as number)
        : 0;
      systemPrice = panelOnlyPrice ? panelOnlyPrice + addOnCost - bundleDiscount : addOnCost;
      batteryAddOnCost = addOnCost;
    }

    // Inverter
    const inverterModel = (b.inverterModel as string) || null;

    // Monthly payment
    const monthlyPayment = (b.monthlyPayment as number) || null;

    return {
      name: bName,
      systemPrice: Math.round(systemPrice * 100) / 100,
      batteryAddOnCost: batteryAddOnCost != null ? Math.round(batteryAddOnCost * 100) / 100 : null,
      panelModel: pkgPanelModel,
      panelWattageW: pkgPanelWattage,
      panelCount: pkgPanelCount,
      systemSizeKw: systemSizeKw ? Math.round(systemSizeKw * 100) / 100 : null,
      batteryModel: hasBattery ? batteryModel : null,
      batteryCapacityKwh: capacityKwh,
      hasBattery,
      inverterModel,
      monthlyPayment,
    };
  });

  // Add solar-only packages (Stag Solar stores these separately)
  for (const so of solarOnlyPackages) {
    const soPrice = (so.price as number) || 0;
    packages.push({
      name: (so.name || "Solar Only") as string,
      systemPrice: Math.round(soPrice * 100) / 100,
      batteryAddOnCost: null,
      panelModel: topPanelModel,
      panelWattageW: topPanelWattage,
      panelCount: topPanelCount,
      systemSizeKw: topPanelCount && topPanelWattage ? Math.round(topPanelCount * topPanelWattage) / 1000 : null,
      batteryModel: null,
      batteryCapacityKwh: 0,
      hasBattery: false,
      inverterModel: (so.inverterModel as string) || null,
      monthlyPayment: null,
    });
  }

  // If panelOnlyPrice exists and no solar-only package was added, add one
  if (panelOnlyPrice && !packages.some((p) => !p.hasBattery)) {
    packages.push({
      name: "Solar Only (panels)",
      systemPrice: panelOnlyPrice,
      batteryAddOnCost: null,
      panelModel: topPanelModel,
      panelWattageW: topPanelWattage,
      panelCount: topPanelCount,
      systemSizeKw: topPanelCount && topPanelWattage ? Math.round(topPanelCount * topPanelWattage) / 1000 : null,
      batteryModel: null,
      batteryCapacityKwh: 0,
      hasBattery: false,
      inverterModel: null,
      monthlyPayment: null,
    });
  }

  // Sort by price
  packages.sort((a, b) => a.systemPrice - b.systemPrice);

  // Panel price points
  const rawPoints = (rawMatrix.panelPricePoints || []) as Array<Record<string, unknown>>;
  const panelPricePoints = rawPoints.map((p) => ({
    panelCount: (p.panelCount as number) || 0,
    price: Math.round(((p.panelOnlyPrice ?? p.price) as number) * 100) / 100 || 0,
  }));

  // Normalize the full price table (every package at every panel count)
  const normalizedPriceTable: Record<number, NormalizedPackage[]> = {};
  if (priceTable) {
    for (const [qty, pkgs] of Object.entries(priceTable)) {
      const count = Number(qty);
      normalizedPriceTable[count] = (pkgs as Array<Record<string, unknown>>).map((p) => {
        const isBat = (p.isBattery as boolean) ?? false;
        return {
          name: (p.name || "Unknown") as string,
          systemPrice: Math.round(((p.price as number) || 0) * 100) / 100,
          batteryAddOnCost: isBat ? Math.round(((p.batteryCost as number) || 0) * 100) / 100 : null,
          panelModel: topPanelModel,
          panelWattageW: topPanelWattage,
          panelCount: count,
          systemSizeKw: topPanelWattage ? Math.round(count * topPanelWattage) / 1000 : null,
          batteryModel: isBat ? (p.batteryModel as string) || (p.name as string) : null,
          batteryCapacityKwh: (p.batteryCapacityKwh as number) || (isBat ? null : 0),
          hasBattery: isBat,
          inverterModel: null,
          monthlyPayment: null,
        };
      }).sort((a, b) => a.systemPrice - b.systemPrice);
    }
  }

  return {
    installerName,
    installerId,
    scrapedAt,
    postcode,
    defaultPanelModel: topPanelModel,
    defaultPanelWattageW: topPanelWattage,
    defaultPanelCount: topPanelCount,
    panelOnlyPrice,
    packages,
    panelPricePoints,
    priceTable: normalizedPriceTable,
  };
}

/** Extract wattage from a model name string or explicit value */
function extractWattage(model: string | null | undefined, explicit?: number): number | null {
  if (explicit && explicit > 10) return explicit; // Already a wattage value (not kW)
  if (!model) return null;
  const match = model.match(/(\d{3,4})\s*[wW]/);
  return match ? parseInt(match[1], 10) : null;
}
