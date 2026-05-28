import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, marketingSignals, linkedinCompanyTracking } from "@/lib/db/schema";
import { eq, sql, and, isNull, isNotNull } from "drizzle-orm";

export async function GET() {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(installers)
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(linkedinCompanyTracking, eq(installers.id, linkedinCompanyTracking.installerId))
    .where(
      and(
        isNotNull(installers.website),
        sql`${installers.website} != ''`,
        sql`(${marketingSignals.installerId} IS NOT NULL OR ${installers.websiteStatus} = 'found')`,
        sql`COALESCE(${installers.websiteStatus}, '') != 'not_found'`,
        sql`(${marketingSignals.linkedinUrl} IS NULL OR ${marketingSignals.linkedinUrl} = '')`,
        isNull(linkedinCompanyTracking.id)
      )
    );

  const eligible = Number(result.count);
  const estimatedCost = (eligible / 1000) * 4; // $4 per 1K

  return NextResponse.json({
    eligible,
    estimatedCost: `~$${estimatedCost.toFixed(2)}`,
  });
}
