import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enrichGoogleBusinessBatch } from "@/lib/enrichment/google-business";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const priority = body.priority === "standard" ? 1 : 2;

  const [job] = await db
    .insert(enrichmentJobs)
    .values({ type: "google_business", status: "pending", totalItems: 0, processedItems: 0, errorCount: 0 })
    .returning();

  enrichGoogleBusinessBatch(job.id, priority as 1 | 2).catch(async (err) => {
    await db.update(enrichmentJobs).set({
      status: "failed", errorLog: JSON.stringify([String(err)]), completedAt: new Date().toISOString(),
    }).where(eq(enrichmentJobs.id, job.id));
  });

  return NextResponse.json({ jobId: job.id, status: "started" });
}
