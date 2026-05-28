import { NextRequest, NextResponse } from "next/server";
import { lookupLinkedInCompaniesBatch } from "@/lib/enrichment/linkedin-company-lookup";

export const maxDuration = 120; // Vercel Pro: up to 5 min

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const batchSize = Math.min(body.batchSize || 50, 100);

  try {
    const result = await lookupLinkedInCompaniesBatch({ batchSize });

    return NextResponse.json({
      status: result.remaining > 0 ? "in_progress" : "completed",
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
