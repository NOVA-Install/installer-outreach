import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  await inngest.send({ name: "enrichment/linkedin-posts-bulk", data: {} });
  return NextResponse.json({ status: "started" });
}
