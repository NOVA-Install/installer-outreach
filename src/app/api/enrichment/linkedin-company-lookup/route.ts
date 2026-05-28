import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const maxCompanies = body.maxCompanies || 500;

  await inngest.send({
    name: "enrichment/linkedin-company-lookup",
    data: { maxCompanies },
  });

  return NextResponse.json({ status: "started", maxCompanies });
}
