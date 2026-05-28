import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const keywords = Array.isArray(body.keywords) ? body.keywords : undefined;
  const postedLimit = body.postedLimit || "week";
  const maxCompanies = body.maxCompanies || undefined;

  await inngest.send({
    name: "enrichment/linkedin-signals",
    data: { keywords, postedLimit, companyBatchSize: 1, maxCompanies },
  });

  return NextResponse.json({ status: "started", postedLimit, maxCompanies: maxCompanies || "all" });
}
