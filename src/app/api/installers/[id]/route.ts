import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  trustpilotReviews,
  reviewItems,
  companiesHouseData,
  marketingSignals,
  seoData,
  trafficData,
  keywordData,
  activities,
  dataforseoTasks,
  installerTags,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);

  const [installer] = await db
    .select()
    .from(installers)
    .where(eq(installers.id, installerId))
    .limit(1);

  if (!installer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(installer);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  const body = await request.json();

  // Only allow updating specific fields
  const allowedFields = ["website", "email", "telephone", "address", "companyName", "isShortlisted", "priority", "priorityNote"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  await db
    .update(installers)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(installers.id, installerId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);

  // Delete all related records first
  const relatedTables = [
    { table: reviewItems, fk: reviewItems.installerId },
    { table: activities, fk: activities.installerId },
    { table: dataforseoTasks, fk: dataforseoTasks.installerId },
    { table: keywordData, fk: keywordData.installerId },
    { table: googleReviews, fk: googleReviews.installerId },
    { table: trustpilotReviews, fk: trustpilotReviews.installerId },
    { table: companiesHouseData, fk: companiesHouseData.installerId },
    { table: marketingSignals, fk: marketingSignals.installerId },
    { table: seoData, fk: seoData.installerId },
    { table: trafficData, fk: trafficData.installerId },
    { table: installerScores, fk: installerScores.installerId },
    { table: installerTags, fk: installerTags.installerId },
  ];

  for (const { table, fk } of relatedTables) {
    await db.delete(table).where(eq(fk, installerId));
  }

  await db.delete(installers).where(eq(installers.id, installerId));

  return NextResponse.json({ ok: true });
}
