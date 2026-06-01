/**
 * Test Boxt API-based scraper — no browser needed.
 * Run with: npx tsx scripts/test-boxt-api.ts
 */

import { scrapeBoxtApi } from "../src/lib/mystery-shopping/scrapers/boxt-api";
import type { PropertyInput } from "../src/lib/mystery-shopping/scrapers/base";

const TEST_PROPERTY: PropertyInput = {
  address: "1 Example Road, Harrogate",
  postcode: "HG1 2ER",
  propertyType: "detached",
  bedrooms: 4,
  roofOrientation: "south",
  roofType: "pitched",
  annualElectricityUsage: 4000,
  currentElectricityBill: 1400,
};

async function main() {
  console.log("Fetching Boxt pricing via API...");
  console.log("Postcode:", TEST_PROPERTY.postcode);
  console.log();

  const result = await scrapeBoxtApi(null, "", TEST_PROPERTY);

  console.log("Success:", result.success);
  console.log("Platform:", result.platform);

  if (result.error) {
    console.log("Error:", result.error);
    return;
  }

  if (result.rawData?.priceMatrix) {
    const m = result.rawData.priceMatrix as Record<string, unknown>;

    console.log("\n--- PRICING ---");
    console.log("Recommended panels:", m.recommendedPanelCount);
    console.log("Panel-only price: £" + m.panelOnlyPrice);
    console.log("Total price (with battery): £" + m.totalPrice);
    console.log("Original price (before discount): £" + m.originalTotalPrice);
    console.log("Price per panel: £" + m.pricePerPanel);
    console.log("Recommended battery: " + m.recommendedBatteryCapacityKwh + " kWh");

    console.log("\n--- SAVINGS ---");
    console.log("Annual savings: £" + m.annualSavings);
    console.log("Monthly savings: £" + m.monthlySavings);

    console.log("\n--- PANEL OPTIONS ---");
    const panels = (m.panelOptions as Array<Record<string, unknown>>) || [];
    if (panels.length === 0) console.log("  (none in response — may need basket endpoint)");
    for (const p of panels) {
      console.log(`  ${p.name}: £${p.pricePerUnit}/panel`);
    }

    console.log("\n--- BATTERY OPTIONS ---");
    const batteries = (m.batteryOptions as Array<Record<string, unknown>>) || [];
    if (batteries.length === 0) console.log("  (none in response — may need basket endpoint)");
    for (const b of batteries) {
      console.log(`  ${b.name}: ${b.capacityKwh}kWh — £${b.price}`);
      // Show all fields for debugging
      console.log(`    All fields:`, JSON.stringify(b));
    }

    console.log("\n--- INVERTER OPTIONS ---");
    const inverters = (m.inverterOptions as Array<Record<string, unknown>>) || [];
    if (inverters.length === 0) console.log("  (none in response — may need basket endpoint)");
    for (const inv of inverters) {
      console.log(`  ${inv.name}: £${inv.price}`);
    }

    console.log("\n--- RAW META ---");
    console.log(JSON.stringify(m._raw, null, 2));
  }
}

main().catch(console.error);
