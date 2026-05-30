import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { priceScrapeResults, installers } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { CALCULATOR_REGISTRY } from "@/lib/mystery-shopping/calculator-scraper";

export async function GET() {
  // Return all configured scrapers with their latest result
  const configs = await Promise.all(
    CALCULATOR_REGISTRY.map(async (config) => {
      // Get installer info
      const [installer] = await db
        .select({
          id: installers.id,
          companyName: installers.companyName,
          website: installers.website,
          postcode: installers.postcode,
        })
        .from(installers)
        .where(eq(installers.id, config.installerId));

      // Get latest scrape result
      const [latestResult] = await db
        .select()
        .from(priceScrapeResults)
        .where(eq(priceScrapeResults.installerId, config.installerId))
        .orderBy(desc(priceScrapeResults.scrapedAt))
        .limit(1);

      // Count total scrapes
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(priceScrapeResults)
        .where(eq(priceScrapeResults.installerId, config.installerId));

      return {
        installerId: config.installerId,
        companyName: config.companyName,
        calculatorUrl: config.calculatorUrl,
        installer,
        latestResult,
        totalScrapes: Number(count),
      };
    })
  );

  return NextResponse.json(configs);
}
