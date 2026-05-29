import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  await inngest.send({ name: "enrichment/linkedin-employees-bulk", data: {} });
  return NextResponse.json({ status: "started" });
}
