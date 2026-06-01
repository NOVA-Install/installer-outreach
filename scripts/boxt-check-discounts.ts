import { scrapeBoxtApi } from "../src/lib/mystery-shopping/scrapers/boxt-api";

async function main() {
  const result = await scrapeBoxtApi(null, "", {
    address: "1 Example Road",
    postcode: "HG1 2ER",
    roofType: "pitched",
    annualElectricityUsage: 4000,
  });

  if (!result.success || !result.rawData?.priceMatrix) {
    console.log("Failed:", result.error);
    return;
  }

  const m = result.rawData.priceMatrix as Record<string, unknown>;

  console.log("=== PRICING BREAKDOWN ===");
  console.log("Panel-only price:", m.panelOnlyPrice);
  console.log("Panel-only original:", m.panelOnlyOriginalPrice);
  console.log("Total (recommended):", m.totalPrice);
  console.log("Original total:", m.originalTotalPrice);
  console.log("Discount:", (m.originalTotalPrice as number) - (m.totalPrice as number));
  console.log("Per panel (incremental):", m.pricePerPanel);
  console.log("Recommended panels:", m.recommendedPanelCount);

  console.log("\n=== DISCOUNTS ===");
  console.log(JSON.stringify(m.discounts, null, 2));

  console.log("\n=== PANEL OPTIONS ===");
  console.log(JSON.stringify(m.panelOptions, null, 2));

  console.log("\n=== BATTERY OPTIONS ===");
  const batts = m.batteryOptions as Array<Record<string, unknown>>;
  for (const b of batts) {
    console.log(`  ${b.name}: ${b.capacityKwh}kWh = £${b.price} (system: £${(m.panelOnlyPrice as number) + (b.price as number)})`);
  }
}

main().catch(console.error);
