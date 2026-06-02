import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { outreachMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const messageId = parseInt(id, 10);
  if (isNaN(messageId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const body = await request.json();
  const allowedFields = [
    "contactName", "contactLinkedinUrl", "contactEmail", "contactPhone",
    "platform", "message", "status", "notes",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.updatedAt = new Date().toISOString();

  await db
    .update(outreachMessages)
    .set(updates)
    .where(eq(outreachMessages.id, messageId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const messageId = parseInt(id, 10);
  if (isNaN(messageId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  await db.delete(outreachMessages).where(eq(outreachMessages.id, messageId));
  return NextResponse.json({ ok: true });
}
