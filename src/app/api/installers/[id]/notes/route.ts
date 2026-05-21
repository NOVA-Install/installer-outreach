import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);

  const result = await db
    .select()
    .from(activities)
    .where(eq(activities.installerId, installerId))
    .orderBy(desc(activities.createdAt));

  return NextResponse.json(result);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  const { content } = await request.json();

  if (!content?.trim()) {
    return NextResponse.json(
      { error: "Content is required" },
      { status: 400 }
    );
  }

  const [activity] = await db
    .insert(activities)
    .values({ installerId, type: "note", content: content.trim() })
    .returning();

  return NextResponse.json(activity);
}
