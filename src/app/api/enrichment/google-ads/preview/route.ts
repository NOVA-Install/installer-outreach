import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, trafficData, googleAdsData } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// GET: count eligible installers for google ads based on traffic threshold
export async function GET(request: NextRequest) {
  const minTraffic = Number(request.nextUrl.searchParams.get("minTraffic") || "0");

  const results = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE t.google_organic_etv >= ${minTraffic} AND ga.id IS NULL AND i.website IS NOT NULL AND i.website != '') as eligible,
      COUNT(*) FILTER (WHERE t.google_organic_etv >= ${minTraffic} AND i.website IS NOT NULL AND i.website != '') as total_above_threshold,
      COUNT(*) FILTER (WHERE ga.id IS NOT NULL) as already_enriched
    FROM installers i
    LEFT JOIN traffic_data t ON i.id = t.installer_id
    LEFT JOIN google_ads_data ga ON i.id = ga.installer_id
  `);

  const row = (results as unknown as Record<string, unknown>[])[0] || {};

  return NextResponse.json({
    eligible: Number(row.eligible || 0),
    totalAboveThreshold: Number(row.total_above_threshold || 0),
    alreadyEnriched: Number(row.already_enriched || 0),
    estimatedCost: `$${(Number(row.eligible || 0) * 0.002).toFixed(2)}`,
    minTraffic,
  });
}
