import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { marketingSignals } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const postedLimit = request.nextUrl.searchParams.get("postedLimit") || "week";

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(marketingSignals)
    .where(
      sql`${marketingSignals.linkedinUrl} IS NOT NULL AND ${marketingSignals.linkedinUrl} LIKE '%/company/%'`
    );

  const eligible = Number(result.count);

  // Post volume multiplier based on time range
  const postMultiplier: Record<string, number> = {
    "24h": 0.15,
    "week": 1,
    "month": 4,
    "3months": 10,
    "6months": 18,
    "year": 30,
  };
  const multiplier = postMultiplier[postedLimit] ?? 1;

  // Cost estimate
  const emptyQueryRate = 0.95;
  const avgPostsPerHit = 3 * multiplier;
  const hitRate = 1 - emptyQueryRate;

  const emptyQueryCost = eligible * emptyQueryRate * (1 / 1000);
  const postCost = eligible * hitRate * avgPostsPerHit * (2 / 1000);
  const actorStartCost = eligible * 0.00005;

  const estimatedCost = emptyQueryCost + postCost + actorStartCost;

  return NextResponse.json({
    eligible,
    estimatedCost: `~$${estimatedCost.toFixed(2)}`,
    postedLimit,
  });
}
