import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const maxCompanies = body.maxCompanies || 100;

  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      type: "linkedin_company_lookup",
      status: "running",
      totalItems: 0,
      processedItems: 0,
      errorCount: 0,
      startedAt: new Date().toISOString(),
    })
    .returning();

  const { enrichLinkedInCompanyLookup } = await import(
    "@/lib/enrichment/linkedin-company-lookup"
  );
  enrichLinkedInCompanyLookup(job.id, { maxCompanies }).catch((err) => {
    console.error("[linkedin-company-lookup] Background run failed:", err);
  });

  return NextResponse.json({
    status: "started",
    jobId: job.id,
    maxCompanies,
  });
}
