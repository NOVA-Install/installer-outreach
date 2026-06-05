import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);

  const [competitor] = await db
    .select()
    .from(competitors)
    .where(eq(competitors.id, competitorId))
    .limit(1);

  if (!competitor) {
    return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  }

  if (!competitor.linkedinUrl) {
    return NextResponse.json({ error: "No LinkedIn URL set" }, { status: 400 });
  }

  // Trigger Inngest background job
  await inngest.send({
    name: "competitor/scrape-posts",
    data: { competitorId },
  });

  return NextResponse.json({
    ok: true,
    message: `Scraping posts & reactions for ${competitor.name} in the background`,
  });
}
