import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const keywords = Array.isArray(body.keywords) ? body.keywords : undefined;
  const postedLimit = body.postedLimit || "week";
  const companyBatchSize = body.companyBatchSize || 1;
  const maxCompanies = body.maxCompanies || undefined;

  // Create job record
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      type: "linkedin_signals",
      status: "running",
      totalItems: 0,
      processedItems: 0,
      errorCount: 0,
      startedAt: new Date().toISOString(),
    })
    .returning();

  // Run directly (no Inngest required) — fire and forget
  const { enrichLinkedInSignalsBatch } = await import("@/lib/enrichment/linkedin-signals");
  enrichLinkedInSignalsBatch(job.id, {
    keywords,
    postedLimit,
    companyBatchSize,
    maxCompanies,
  }).catch((err) => {
    console.error("[linkedin-signals] Background run failed:", err);
  });

  return NextResponse.json({
    status: "started",
    jobId: job.id,
    keywords: keywords?.length,
    postedLimit,
    companyBatchSize,
    maxCompanies: maxCompanies || "all",
  });
}
