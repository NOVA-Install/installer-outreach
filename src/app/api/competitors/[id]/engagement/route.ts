import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitorPostEngagement, installers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

// List the people who reacted/commented on a given post.
// Matched-to-installer engagers are returned first.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);
  const { searchParams } = new URL(request.url);
  const postId = searchParams.get("postId");

  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: competitorPostEngagement.id,
      engagerName: competitorPostEngagement.engagerName,
      engagerProfileId: competitorPostEngagement.engagerProfileId,
      engagerHeadline: competitorPostEngagement.engagerHeadline,
      engagerProfileUrl: competitorPostEngagement.engagerProfileUrl,
      engagerCompany: competitorPostEngagement.engagerCompany,
      engagementType: competitorPostEngagement.engagementType,
      commentText: competitorPostEngagement.commentText,
      installerId: competitorPostEngagement.installerId,
      installerName: installers.companyName,
      installerPostcode: installers.postcode,
    })
    .from(competitorPostEngagement)
    .leftJoin(installers, eq(competitorPostEngagement.installerId, installers.id))
    .where(
      and(
        eq(competitorPostEngagement.postId, parseInt(postId, 10)),
        eq(competitorPostEngagement.competitorId, competitorId)
      )
    )
    // Matched installers first (NULL sorts last), then by name
    .orderBy(
      sql`${competitorPostEngagement.installerId} IS NULL`,
      competitorPostEngagement.engagerName
    );

  return NextResponse.json(rows);
}

// Manually link (or unlink) an engager to an installer.
// Body: { engagementId: number, installerId: number | null }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);
  const body = await request.json();
  const { engagementId, installerId } = body;

  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  await db
    .update(competitorPostEngagement)
    .set({ installerId: installerId ?? null })
    .where(
      and(
        eq(competitorPostEngagement.id, engagementId),
        eq(competitorPostEngagement.competitorId, competitorId)
      )
    );

  return NextResponse.json({ ok: true });
}
