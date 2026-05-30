import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mysteryShopCampaigns } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const campaigns = await db
    .select()
    .from(mysteryShopCampaigns)
    .orderBy(desc(mysteryShopCampaigns.createdAt));

  return NextResponse.json(campaigns);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, zones, systemSpec, propertyConfig } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [campaign] = await db
    .insert(mysteryShopCampaigns)
    .values({
      name,
      zones: zones ? JSON.stringify(zones) : null,
      systemSpec: systemSpec || null,
      propertyConfig: propertyConfig ? JSON.stringify(propertyConfig) : null,
    })
    .returning();

  return NextResponse.json(campaign);
}
