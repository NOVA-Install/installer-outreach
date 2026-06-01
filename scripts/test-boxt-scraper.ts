/**
 * Quick test script for the Boxt calculator scraper.
 * Run with: npx tsx scripts/test-boxt-scraper.ts
 *
 * Uses a hardcoded property — no DB or zone config needed.
 * Opens a visible browser so you can watch the scraper work.
 */

import { chromium } from "playwright";
import { scrapeBoxt } from "../src/lib/mystery-shopping/scrapers/boxt";
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
  console.log("Launching browser...\n");
  const browser = await chromium.launch({
    headless: false, // Watch it work — set to true for CI
    slowMo: 200, // Slow down so you can follow along
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  const page = await context.newPage();

  console.log("Scraping Boxt configurator (multi-config)...\n");
  const result = await scrapeBoxt(
    page,
    "https://app.boxt.co.uk/solar/configurator",
    TEST_PROPERTY
  );

  console.log("=== RESULT ===");
  console.log("Success:", result.success);
  console.log("Platform:", result.platform);
  console.log("Screenshot:", result.screenshotPath);

  if (result.error) {
    console.log("Error:", result.error);
  }

  if (result.rawData?.priceMatrix) {
    const m = result.rawData.priceMatrix as Record<string, unknown>;

    console.log("\n--- PANEL INFO ---");
    console.log("Model:", m.panelModel);
    console.log("Recommended count:", m.recommendedPanelCount);
    console.log("Panel warranty:", m.panelWarrantyYears, "years");
    console.log("Price per panel:", m.pricePerPanel ? `£${m.pricePerPanel}` : "unknown");
    console.log("Panel-only price:", m.panelOnlyPrice ? `£${m.panelOnlyPrice}` : "unknown");

    console.log("\n--- PANEL PRICE POINTS ---");
    const points = (m.panelPricePoints as Array<{ panelCount: number; systemKw: string; totalPrice: number }>) || [];
    for (const p of points) {
      console.log(`  ${p.panelCount} panels (${p.systemKw}): £${p.totalPrice}`);
    }

    console.log("\n--- BATTERY OPTIONS ---");
    const batteries = (m.batteryOptions as Array<{ tier: string; model: string; capacityKwh: string; totalPrice: number; monthlySavings: string | null }>) || [];
    for (const b of batteries) {
      const batteryCost = m.panelOnlyPrice ? `(battery: £${b.totalPrice - (m.panelOnlyPrice as number)})` : "";
      console.log(`  [${b.tier}] ${b.model} ${b.capacityKwh}kWh: £${b.totalPrice} ${batteryCost} ${b.monthlySavings || ""}`);
    }

    console.log("\n--- INCLUDED ---");
    const extras = (m.includedExtras as string[]) || [];
    for (const e of extras) {
      console.log(`  ✓ ${e}`);
    }
  }

  console.log("\nDone. Closing browser in 5 seconds...");
  await new Promise((r) => setTimeout(r, 5000));
  await browser.close();
}

main().catch(console.error);
