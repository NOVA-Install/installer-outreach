import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitorClients, installers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);

  const clients = await db
    .select({
      id: competitorClients.id,
      installerId: competitorClients.installerId,
      source: competitorClients.source,
      confidence: competitorClients.confidence,
      notes: competitorClients.notes,
      addedAt: competitorClients.addedAt,
      companyName: installers.companyName,
      website: installers.website,
      email: installers.email,
      postcode: installers.postcode,
      pipelineStage: installers.pipelineStage,
    })
    .from(competitorClients)
    .innerJoin(installers, eq(competitorClients.installerId, installers.id))
    .where(eq(competitorClients.competitorId, competitorId))
    .orderBy(installers.companyName);

  return NextResponse.json(clients);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);
  const body = await request.json();
  const { installerId, notes, source } = body;

  if (!installerId) {
    return NextResponse.json({ error: "installerId is required" }, { status: 400 });
  }

  // Check for duplicate
  const existing = await db
    .select()
    .from(competitorClients)
    .where(and(eq(competitorClients.competitorId, competitorId), eq(competitorClients.installerId, installerId)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "Already a client" }, { status: 409 });
  }

  const [row] = await db
    .insert(competitorClients)
    .values({ competitorId, installerId, notes, source: source || "manual" })
    .returning();

  return NextResponse.json(row);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  await db
    .delete(competitorClients)
    .where(and(eq(competitorClients.id, parseInt(clientId, 10)), eq(competitorClients.competitorId, competitorId)));

  return NextResponse.json({ ok: true });
}
