import { NextRequest, NextResponse } from "next/server";
import { searchLinkedInSignalsBatch } from "@/lib/enrichment/linkedin-signals";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const keywords = Array.isArray(body.keywords) ? body.keywords : undefined;
  const postedLimit = body.postedLimit || "week";
  const batchSize = Math.min(body.batchSize || 20, 50);

  try {
    const result = await searchLinkedInSignalsBatch({
      keywords,
      postedLimit,
      batchSize,
    });

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
