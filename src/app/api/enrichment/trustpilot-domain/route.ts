import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const priority = body.priority === "standard" ? 1 : 2;

  await inngest.send({ name: "enrichment/trustpilot-domain", data: { priority } });
  return NextResponse.json({ status: "started" });
}
