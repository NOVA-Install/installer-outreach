import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitors, competitorPosts } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";

// (Re)scrape reactions + comments for this competitor's already-stored posts.
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

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(competitorPosts)
    .where(eq(competitorPosts.competitorId, competitorId));

  if (!count) {
    return NextResponse.json(
      { error: "No posts to scrape engagement for. Scrape posts first." },
      { status: 400 }
    );
  }

  await inngest.send({
    name: "competitor/scrape-engagement",
    data: { competitorId },
  });

  return NextResponse.json({
    ok: true,
    message: `Scraping reactions & comments for ${count} posts in the background`,
  });
}
