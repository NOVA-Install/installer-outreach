import { NextRequest, NextResponse } from "next/server";
import { previewLinkedInPostsBulk } from "@/lib/enrichment/linkedin-posts-bulk";

export async function GET(request: NextRequest) {
  const result = await previewLinkedInPostsBulk();
  return NextResponse.json(result);
}
