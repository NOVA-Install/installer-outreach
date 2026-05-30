import { scrapeSolarFastApi } from "../src/lib/mystery-shopping/scrapers/solarfast-api";

async function main() {
  console.log("Fetching SolarFast/Wickes pricing via API...\n");

  const result = await scrapeSolarFastApi(null, "", {
    address: "1 Example Road",
    postcode: "HG1 2ER",
    propertyType: "detached",
    roofType: "pitched",
    annualElectricityUsage: 4000,
  });

  console.log("Success:", result.success);
  console.log("Platform:", result.platform);

  if (result.error) {
    console.log("Error:", result.error);
    return;
  }

  if (result.rawData?.priceMatrix) {
    const m = result.rawData.priceMatrix as Record<string, unknown>;
    console.log("\nPanel model:", m.panelModel);
    console.log("Recommended panels:", m.recommendedPanelCount);
    console.log("Per panel (incremental):", m.pricePerPanel ? `£${m.pricePerPanel}` : "unknown");
    console.log("Total price:", m.totalPrice ? `£${m.totalPrice}` : "unknown");

    console.log("\n--- PACKAGES ---");
    const packages = m._packages as Array<Record<string, unknown>>;
    for (const p of packages) {
      console.log(`\n  ${p.name}`);
      console.log(`    Full object keys:`, Object.keys(p));
      console.log(`    Raw:`, JSON.stringify(p).slice(0, 500));
    }
  }
}

main().catch(console.error);
