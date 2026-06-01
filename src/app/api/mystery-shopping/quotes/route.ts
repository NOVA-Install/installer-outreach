import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mysteryShopQuotes, mysteryShopTargets, mysteryShopCampaigns, installers } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const campaignId = searchParams.get("campaignId")
    ? Number(searchParams.get("campaignId"))
    : undefined;

  let query = db
    .select({
      quote: mysteryShopQuotes,
      target: mysteryShopTargets,
      installer: {
        id: installers.id,
        companyName: installers.companyName,
        website: installers.website,
        postcode: installers.postcode,
      },
      campaign: {
        id: mysteryShopCampaigns.id,
        name: mysteryShopCampaigns.name,
      },
    })
    .from(mysteryShopQuotes)
    .innerJoin(mysteryShopTargets, eq(mysteryShopQuotes.targetId, mysteryShopTargets.id))
    .innerJoin(installers, eq(mysteryShopTargets.installerId, installers.id))
    .innerJoin(mysteryShopCampaigns, eq(mysteryShopTargets.campaignId, mysteryShopCampaigns.id))
    .orderBy(desc(mysteryShopQuotes.createdAt))
    .$dynamic();

  if (campaignId) {
    query = query.where(eq(mysteryShopTargets.campaignId, campaignId));
  }

  const results = await query;

  return NextResponse.json(results);
}
