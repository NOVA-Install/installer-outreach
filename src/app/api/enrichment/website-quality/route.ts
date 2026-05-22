import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST() {
  await inngest.send({ name: "enrichment/website-quality", data: {} });
  return NextResponse.json({ status: "started" });
}
