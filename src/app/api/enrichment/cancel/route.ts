import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichmentJobs } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const { jobId } = await request.json().catch(() => ({}));

  if (jobId) {
    // Cancel a specific job
    await db
      .update(enrichmentJobs)
      .set({ status: "cancelled", completedAt: new Date().toISOString() })
      .where(eq(enrichmentJobs.id, jobId));
  } else {
    // Cancel all running/pending jobs
    await db
      .update(enrichmentJobs)
      .set({ status: "cancelled", completedAt: new Date().toISOString() })
      .where(or(eq(enrichmentJobs.status, "running"), eq(enrichmentJobs.status, "pending")));
  }

  return NextResponse.json({ ok: true });
}
