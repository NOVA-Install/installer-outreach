import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST() {
  await inngest.send({ name: "enrichment/site-analysis", data: {} });
  return NextResponse.json({ status: "started" });
}
