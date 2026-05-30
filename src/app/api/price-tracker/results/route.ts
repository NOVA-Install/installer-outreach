import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { priceScrapeResults, installers } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const installerId = searchParams.get("installerId")
    ? Number(searchParams.get("installerId"))
    : undefined;
  const limit = searchParams.get("limit")
    ? Number(searchParams.get("limit"))
    : 50;

  let query = db
    .select({
      result: priceScrapeResults,
      installer: {
        id: installers.id,
        companyName: installers.companyName,
      },
    })
    .from(priceScrapeResults)
    .innerJoin(installers, eq(priceScrapeResults.installerId, installers.id))
    .orderBy(desc(priceScrapeResults.scrapedAt))
    .limit(limit)
    .$dynamic();

  if (installerId) {
    query = query.where(eq(priceScrapeResults.installerId, installerId));
  }

  const results = await query;

  return NextResponse.json(results);
}
