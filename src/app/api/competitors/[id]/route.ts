import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);
  const body = await request.json();

  const allowedFields = ["name", "website", "linkedinUrl", "linkedinSlug", "notes"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }

  // Auto-extract slug from linkedinUrl
  if (body.linkedinUrl && !body.linkedinSlug) {
    const match = body.linkedinUrl.match(/linkedin\.com\/company\/([^/?]+)/);
    if (match) updates.linkedinSlug = match[1];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  await db.update(competitors).set(updates).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);
  await db.delete(competitors).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}
