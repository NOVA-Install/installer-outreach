import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const minTraffic = body.minTraffic || 0;
  const shortlistedOnly = body.shortlistedOnly === true;

  await inngest.send({ name: "enrichment/google-ads", data: { minTraffic, shortlistedOnly } });
  return NextResponse.json({ status: "started", minTraffic, shortlistedOnly });
}
