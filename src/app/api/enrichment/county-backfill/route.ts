import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, enrichmentJobs } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";
import { getCountyFromPostcode } from "@/lib/enrichment/postcode-county";

export async function POST() {
  // Find installers with postcode but no county
  const missing = await db
    .select({ id: installers.id, postcode: installers.postcode })
    .from(installers)
    .where(
      sql`${installers.postcode} IS NOT NULL AND ${installers.postcode} != '' AND (${installers.county} IS NULL OR ${installers.county} = '')`
    );

  if (missing.length === 0) {
    return NextResponse.json({ filled: 0, total: 0, message: "All installers already have a county" });
  }

  // Create a job for tracking
  const [job] = await db.insert(enrichmentJobs).values({
    type: "county_backfill",
    status: "running",
    totalItems: missing.length,
    processedItems: 0,
    errorCount: 0,
    startedAt: new Date().toISOString(),
  }).returning();

  let filled = 0;
  let skipped = 0;

  for (const inst of missing) {
    const county = getCountyFromPostcode(inst.postcode!);
    if (county) {
      await db
        .update(installers)
        .set({ county, updatedAt: new Date().toISOString() })
        .where(eq(installers.id, inst.id));
      filled++;
    } else {
      skipped++;
    }
  }

  await db.update(enrichmentJobs).set({
    processedItems: filled,
    errorCount: skipped,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, job.id));

  return NextResponse.json({
    filled,
    skipped,
    total: missing.length,
    message: `Filled county for ${filled} installers, ${skipped} had unrecognised postcodes`,
  });
}
