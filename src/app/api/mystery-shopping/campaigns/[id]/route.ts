import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mysteryShopCampaigns, mysteryShopTargets, mysteryShopQuotes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaignId = Number(id);

  const [campaign] = await db
    .select()
    .from(mysteryShopCampaigns)
    .where(eq(mysteryShopCampaigns.id, campaignId));

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Get targets with their quotes
  const targets = await db
    .select()
    .from(mysteryShopTargets)
    .where(eq(mysteryShopTargets.campaignId, campaignId));

  const targetIds = targets.map((t) => t.id);
  let quotes: (typeof mysteryShopQuotes.$inferSelect)[] = [];
  if (targetIds.length > 0) {
    quotes = await db
      .select()
      .from(mysteryShopQuotes)
      .where(
        // Get quotes for all targets in this campaign
        // Using inArray would be ideal but let's keep it simple
        eq(mysteryShopQuotes.targetId, targetIds[0])
      );
    // For multiple targets, we need to get all quotes
    if (targetIds.length > 1) {
      const { inArray } = await import("drizzle-orm");
      quotes = await db
        .select()
        .from(mysteryShopQuotes)
        .where(inArray(mysteryShopQuotes.targetId, targetIds));
    }
  }

  return NextResponse.json({ campaign, targets, quotes });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaignId = Number(id);
  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.zones !== undefined) updateData.zones = body.zones ? JSON.stringify(body.zones) : null;
  if (body.systemSpec !== undefined) updateData.systemSpec = body.systemSpec;
  if (body.propertyConfig !== undefined) updateData.propertyConfig = body.propertyConfig ? JSON.stringify(body.propertyConfig) : null;
  if (body.startedAt !== undefined) updateData.startedAt = body.startedAt;
  if (body.completedAt !== undefined) updateData.completedAt = body.completedAt;
  if (body.totalTargets !== undefined) updateData.totalTargets = body.totalTargets;
  if (body.processedTargets !== undefined) updateData.processedTargets = body.processedTargets;
  if (body.errorCount !== undefined) updateData.errorCount = body.errorCount;

  const [updated] = await db
    .update(mysteryShopCampaigns)
    .set(updateData)
    .where(eq(mysteryShopCampaigns.id, campaignId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
