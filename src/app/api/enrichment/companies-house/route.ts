import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enrichCompaniesHouse } from "@/lib/enrichment/companies-house";

export async function POST() {
  const [job] = await db
    .insert(enrichmentJobs)
    .values({
      type: "companies_house",
      status: "pending",
      totalItems: 0,
      processedItems: 0,
      errorCount: 0,
    })
    .returning();

  enrichCompaniesHouse(job.id).catch(async (err) => {
    await db
      .update(enrichmentJobs)
      .set({
        status: "failed",
        errorLog: JSON.stringify([String(err)]),
        completedAt: new Date().toISOString(),
      })
      .where(eq(enrichmentJobs.id, job.id));
  });

  return NextResponse.json({ jobId: job.id, status: "started" });
}
