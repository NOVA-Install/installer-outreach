import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { marketingSignals } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  // Count company LinkedIn URLs (only /company/ URLs work with authorsCompanies filter)
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(marketingSignals)
    .where(
      sql`${marketingSignals.linkedinUrl} IS NOT NULL AND ${marketingSignals.linkedinUrl} LIKE '%/company/%'`
    );

  const eligible = Number(result.count);

  // Cost estimate: mostly empty queries at $1/1K + a few posts at $2/1K + actor starts
  const emptyQueryRate = 0.95;
  const avgPostsPerHit = 3;
  const hitRate = 1 - emptyQueryRate;

  const emptyQueryCost = eligible * emptyQueryRate * (1 / 1000); // $1/1K
  const postCost = eligible * hitRate * avgPostsPerHit * (2 / 1000); // $2/1K
  const actorStartCost = eligible * 0.00005;

  const estimatedCost = emptyQueryCost + postCost + actorStartCost;

  return NextResponse.json({
    eligible,
    estimatedCost: `~$${estimatedCost.toFixed(2)}`,
    breakdown: {
      emptyQueries: `~${Math.round(eligible * emptyQueryRate)} @ $1/1K = $${emptyQueryCost.toFixed(2)}`,
      posts: `~${Math.round(eligible * hitRate * avgPostsPerHit)} @ $2/1K = $${postCost.toFixed(2)}`,
      actorStarts: `${eligible} @ $0.00005 = $${actorStartCost.toFixed(2)}`,
    },
  });
}
