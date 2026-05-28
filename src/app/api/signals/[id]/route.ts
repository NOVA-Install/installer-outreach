import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialSignals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const signalId = parseInt(id, 10);
  if (isNaN(signalId)) {
    return NextResponse.json({ error: "Invalid signal ID" }, { status: 400 });
  }

  const body = await request.json();
  const { status } = body;

  if (!["new", "dismissed", "actioned"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await db
    .update(socialSignals)
    .set({ status })
    .where(eq(socialSignals.id, signalId));

  return NextResponse.json({ ok: true });
}
