import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichmentJobs, installers, trafficData, googleAdsData } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { enrichGoogleAdsBatch } from "@/lib/enrichment/google-ads-transparency";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const minTraffic = body.minTraffic || 0;

  const [job] = await db
    .insert(enrichmentJobs)
    .values({ type: "google_ads_transparency", status: "pending", totalItems: 0, processedItems: 0, errorCount: 0 })
    .returning();

  enrichGoogleAdsBatch(job.id, minTraffic).catch(async (err) => {
    await db.update(enrichmentJobs).set({
      status: "failed", errorLog: JSON.stringify([String(err)]), completedAt: new Date().toISOString(),
    }).where(eq(enrichmentJobs.id, job.id));
  });

  return NextResponse.json({ jobId: job.id, status: "started", minTraffic });
}
