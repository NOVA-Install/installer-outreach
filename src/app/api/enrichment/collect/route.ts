import { NextResponse } from "next/server";
import { collectPendingResults } from "@/lib/enrichment/dataforseo";

export async function POST() {
  const result = await collectPendingResults();
  return NextResponse.json(result);
}
