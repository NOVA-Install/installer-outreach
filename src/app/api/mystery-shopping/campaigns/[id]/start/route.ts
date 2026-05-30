import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { mysteryShopCampaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
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

  if (campaign.status !== "draft") {
    return NextResponse.json(
      { error: `Campaign is already ${campaign.status}` },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const categories = body.categories || ["calculator"];

  // Send Inngest event to create targets and start scraping
  await inngest.send({
    name: "mystery-shopping/create-targets",
    data: { campaignId, categories },
  });

  return NextResponse.json({ status: "started", campaignId });
}
