import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { priceScrapeResults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  CALCULATOR_REGISTRY,
  scrapeInstallerCalculator,
  getPropertyForZone,
} from "@/lib/mystery-shopping/calculator-scraper";

export const maxDuration = 300; // 5 minutes — Playwright scrapes take time

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { installerId, postcode, zoneId } = body;

  if (!installerId) {
    return NextResponse.json({ error: "installerId is required" }, { status: 400 });
  }

  const config = CALCULATOR_REGISTRY.find((c) => c.installerId === installerId);
  if (!config) {
    return NextResponse.json({ error: "No scraper configured for this installer" }, { status: 404 });
  }

  // Create a pending result row
  const [resultRow] = await db
    .insert(priceScrapeResults)
    .values({
      installerId,
      status: "running",
      postcode: postcode || "LS15 8ZB",
    })
    .returning();

  try {
    // Run the scraper
    const result = await scrapeInstallerCalculator(config);

    if (result.success && result.rawData?.priceMatrix) {
      const matrix = result.rawData.priceMatrix as Record<string, unknown>;

      await db
        .update(priceScrapeResults)
        .set({
          status: "completed",
          panelOnlyPrice: matrix.panelOnlyPrice as number | null,
          recommendedPrice: matrix.totalPrice as number | null,
          pricePerPanel: matrix.pricePerPanel as number | null,
          recommendedPanelCount: matrix.recommendedPanelCount as number | null,
          panelModel: matrix.panelModel as string | null,
          priceMatrix: JSON.stringify(matrix),
          screenshotPath: result.screenshotPath,
          propertyConfig: JSON.stringify({
            postcode: matrix.postcode,
            roofType: matrix.roofType,
            electricityUsage: matrix.electricityUsage,
          }),
        })
        .where(eq(priceScrapeResults.id, resultRow.id));

      const [updated] = await db
        .select()
        .from(priceScrapeResults)
        .where(eq(priceScrapeResults.id, resultRow.id));

      return NextResponse.json(updated);
    } else {
      await db
        .update(priceScrapeResults)
        .set({
          status: "failed",
          errorLog: result.error || "Scrape returned no data",
        })
        .where(eq(priceScrapeResults.id, resultRow.id));

      return NextResponse.json(
        { error: result.error || "Scrape failed", resultId: resultRow.id },
        { status: 500 }
      );
    }
  } catch (err) {
    await db
      .update(priceScrapeResults)
      .set({
        status: "failed",
        errorLog: err instanceof Error ? err.message : String(err),
      })
      .where(eq(priceScrapeResults.id, resultRow.id));

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error", resultId: resultRow.id },
      { status: 500 }
    );
  }
}
