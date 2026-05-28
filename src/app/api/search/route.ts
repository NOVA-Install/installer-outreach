import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers } from "@/lib/db/schema";
import { sql, or } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    // Search across company names, legal entity names, postcodes, and company numbers
    const pattern = `%${q}%`;

    const rows = await db
      .select({
        id: installers.id,
        companyName: installers.companyName,
        legalEntityName: installers.legalEntityName,
        legalEntityNumber: installers.legalEntityNumber,
        postcode: installers.postcode,
        county: installers.county,
        website: installers.website,
        pipelineStage: installers.pipelineStage,
      })
      .from(installers)
      .where(
        or(
          sql`${installers.companyName} ILIKE ${pattern}`,
          sql`${installers.alternativeNames} ILIKE ${pattern}`,
          sql`${installers.legalEntityName} ILIKE ${pattern}`,
          sql`${installers.legalEntityNumber} ILIKE ${pattern}`,
          sql`${installers.postcode} ILIKE ${pattern}`,
          sql`${installers.website} ILIKE ${pattern}`
        )
      )
      .limit(20);

    // Categorise results by match type for grouping in the UI
    const lower = q.toLowerCase();
    const results = rows.map((row) => {
      let matchType: "company" | "legal_entity" | "postcode" | "company_number" | "alternative_name" | "website" = "company";

      if (
        row.legalEntityNumber &&
        row.legalEntityNumber.toLowerCase().includes(lower)
      ) {
        matchType = "company_number";
      } else if (
        row.postcode &&
        row.postcode.toLowerCase().includes(lower)
      ) {
        matchType = "postcode";
      } else if (
        row.legalEntityName &&
        row.legalEntityName.toLowerCase().includes(lower) &&
        !(row.companyName && row.companyName.toLowerCase().includes(lower))
      ) {
        matchType = "legal_entity";
      } else if (
        row.website &&
        row.website.toLowerCase().includes(lower)
      ) {
        matchType = "website";
      } else if (
        !(row.companyName && row.companyName.toLowerCase().includes(lower))
      ) {
        matchType = "alternative_name";
      }

      return { ...row, matchType };
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Search API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error", results: [] },
      { status: 500 }
    );
  }
}
