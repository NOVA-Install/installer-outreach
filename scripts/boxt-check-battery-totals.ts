/**
 * Check if the bundle discount applies to all battery options or just the recommended one.
 */
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
  const panelOnly = m.panelOnlyPrice as number;
  const total = m.totalPrice as number;
  const originalTotal = m.originalTotalPrice as number;
  const discount = originalTotal - total;

  console.log(`Panels only: £${panelOnly}`);
  console.log(`Recommended total: £${total} (original: £${originalTotal}, discount: £${discount})`);
  console.log();

  const batts = m.batteryOptions as Array<{ name: string; price: number; capacityKwh: number }>;
  console.log("Battery | Price | Raw Total | With Discount | Matches API Total?");
  console.log("--------|-------|-----------|---------------|-------------------");
  for (const b of batts) {
    const raw = panelOnly + b.price;
    const withDiscount = raw - discount;
    const isRecommended = b.name === "Sunsynk W5.3";
    console.log(
      `${b.name.padEnd(30)} | £${String(b.price).padStart(6)} | £${String(raw).padStart(6)} | £${String(withDiscount).padStart(6)} | ${isRecommended ? `API says £${total}` : "?"}`
    );
  }

  console.log(`\nTo know for sure, we'd need to call the basket update API with each battery.`);
  console.log(`But the discount likely applies to all configs since it's a BOGOF panel promo.`);
}

main().catch(console.error);
