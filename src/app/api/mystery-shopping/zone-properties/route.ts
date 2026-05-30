import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mysteryShopZoneProperties } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const properties = await db
    .select()
    .from(mysteryShopZoneProperties)
    .orderBy(mysteryShopZoneProperties.zoneId);

  return NextResponse.json(properties);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { zoneId, address, postcode, details } = body;

  if (!zoneId || !address || !postcode) {
    return NextResponse.json(
      { error: "zoneId, address, and postcode are required" },
      { status: 400 }
    );
  }

  const [result] = await db
    .insert(mysteryShopZoneProperties)
    .values({
      zoneId,
      address,
      postcode,
      details: details ? JSON.stringify(details) : null,
    })
    .onConflictDoUpdate({
      target: mysteryShopZoneProperties.zoneId,
      set: {
        address,
        postcode,
        details: details ? JSON.stringify(details) : null,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();

  return NextResponse.json(result);
}
