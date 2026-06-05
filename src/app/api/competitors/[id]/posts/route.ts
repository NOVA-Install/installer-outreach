import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitorPosts, competitorPostEngagement } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);

  const posts = await db
    .select({
      id: competitorPosts.id,
      postUrl: competitorPosts.postUrl,
      authorName: competitorPosts.authorName,
      postText: competitorPosts.postText,
      postedAt: competitorPosts.postedAt,
      likes: competitorPosts.likes,
      comments: competitorPosts.comments,
      shares: competitorPosts.shares,
      employeeId: competitorPosts.employeeId,
      scrapedAt: competitorPosts.scrapedAt,
      // How many engagers we captured, and how many we matched to an installer
      engagementCount: sql<number>`count(${competitorPostEngagement.id})::int`,
      matchedCount: sql<number>`count(${competitorPostEngagement.installerId})::int`,
    })
    .from(competitorPosts)
    .leftJoin(
      competitorPostEngagement,
      eq(competitorPostEngagement.postId, competitorPosts.id)
    )
    .where(eq(competitorPosts.competitorId, competitorId))
    .groupBy(competitorPosts.id)
    .orderBy(desc(competitorPosts.postedAt), desc(competitorPosts.scrapedAt));

  return NextResponse.json(posts);
}
