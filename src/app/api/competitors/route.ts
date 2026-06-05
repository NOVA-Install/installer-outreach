import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitors, competitorClients, competitorEmployees, competitorPosts, competitorPostEngagement } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      website: competitors.website,
      linkedinUrl: competitors.linkedinUrl,
      linkedinSlug: competitors.linkedinSlug,
      notes: competitors.notes,
      createdAt: competitors.createdAt,
      clientCount: sql<number>`(SELECT COUNT(*)::int FROM competitor_clients WHERE competitor_id = ${competitors.id})`,
      employeeCount: sql<number>`(SELECT COUNT(*)::int FROM competitor_employees WHERE competitor_id = ${competitors.id})`,
      postCount: sql<number>`(SELECT COUNT(*)::int FROM competitor_posts WHERE competitor_id = ${competitors.id})`,
      engagementCount: sql<number>`(SELECT COUNT(DISTINCT engager_profile_url)::int FROM competitor_post_engagement WHERE competitor_id = ${competitors.id})`,
    })
    .from(competitors)
    .orderBy(competitors.name);

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, website, linkedinUrl, notes } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let linkedinSlug: string | null = null;
  if (linkedinUrl) {
    const match = linkedinUrl.match(/linkedin\.com\/company\/([^/?]+)/);
    if (match) linkedinSlug = match[1];
  }

  const [row] = await db
    .insert(competitors)
    .values({ name, website, linkedinUrl, linkedinSlug, notes })
    .returning();

  return NextResponse.json(row);
}
