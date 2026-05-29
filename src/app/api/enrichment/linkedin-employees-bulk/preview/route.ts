import { NextRequest, NextResponse } from "next/server";
import { previewLinkedInEmployeesBulk } from "@/lib/enrichment/linkedin-employees-bulk";

export async function GET(request: NextRequest) {
  const result = await previewLinkedInEmployeesBulk();
  return NextResponse.json(result);
}
