import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers } from "@/lib/db/schema";
import { eq, isNull, sql, and } from "drizzle-orm";
import { aiMatchCompaniesHouse } from "@/lib/enrichment/ai-matcher";
import { tieredCompanyMatch, type CompanyCandidate } from "@/lib/enrichment/company-matcher";

// GET: list installers without a legal entity name
export async function GET() {
  try {
    const unmatched = await db
      .select({
        id: installers.id,
        companyName: installers.companyName,
        alternativeNames: installers.alternativeNames,
        postcode: installers.postcode,
        legalEntityName: installers.legalEntityName,
        legalEntityNumber: installers.legalEntityNumber,
      })
      .from(installers)
      .where(isNull(installers.legalEntityName))
      .orderBy(installers.companyName)
      .limit(100);

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(installers)
      .where(isNull(installers.legalEntityName));

    const matched = await db
      .select({ count: sql<number>`count(*)` })
      .from(installers)
      .where(sql`${installers.legalEntityName} IS NOT NULL`);

    return NextResponse.json({
      unmatched,
      stats: {
        unmatchedCount: total[0]?.count ?? 0,
        matchedCount: matched[0]?.count ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch data", unmatched: [], stats: { unmatchedCount: 0, matchedCount: 0 } },
      { status: 500 }
    );
  }
}

// POST: lookup a single installer on Companies House and store result
export async function POST(request: NextRequest) {
  const { installerId, action, companyNumber, legalName } = await request.json();

  // Action: "accept" - user accepts a suggested match
  if (action === "accept") {
    await db
      .update(installers)
      .set({
        legalEntityName: legalName,
        legalEntityNumber: companyNumber,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(installers.id, installerId));

    return NextResponse.json({ ok: true });
  }

  // Action: "skip" - mark as no match found
  if (action === "skip") {
    await db
      .update(installers)
      .set({
        legalEntityName: "__no_match__",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(installers.id, installerId));

    return NextResponse.json({ ok: true });
  }

  // Action: "lookup" - search Companies House
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "COMPANIES_HOUSE_API_KEY not set" }, { status: 500 });
  }

  const [installer] = await db
    .select({ companyName: installers.companyName, postcode: installers.postcode })
    .from(installers)
    .where(eq(installers.id, installerId))
    .limit(1);

  if (!installer) {
    return NextResponse.json({ error: "Installer not found" }, { status: 404 });
  }

  const auth = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
  const searchRes = await fetch(
    `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(installer.companyName)}&items_per_page=5`,
    { headers: { Authorization: auth } }
  );

  if (!searchRes.ok) {
    return NextResponse.json(
      { error: `Companies House API error: ${searchRes.status}` },
      { status: 502 }
    );
  }

  const searchData = await searchRes.json();
  const results = (searchData.items || []).map(
    (item: {
      title: string;
      company_number: string;
      company_status: string;
      address?: { postal_code?: string; address_line_1?: string; locality?: string };
    }) => ({
      companyName: item.title,
      companyNumber: item.company_number,
      status: item.company_status,
      address: [item.address?.address_line_1, item.address?.locality, item.address?.postal_code]
        .filter(Boolean)
        .join(", "),
      postcodeMatch: installer.postcode
        ? item.address?.postal_code
            ?.toUpperCase()
            .startsWith(installer.postcode.split(" ")[0].toUpperCase()) ?? false
        : false,
    })
  );

  // Tiered matching: exact → similarity → AI (only if ambiguous)
  // Extract postal codes from the address strings for proper matching
  const chCandidates: CompanyCandidate[] = results.map(
    (r: { companyName: string; companyNumber: string; status: string; address: string; postcodeMatch: boolean }, idx: number) => {
      // Try to extract postcode from the address string (last part after comma)
      const addressParts = r.address ? r.address.split(",").map((s: string) => s.trim()) : [];
      const lastPart = addressParts[addressParts.length - 1] || null;
      // UK postcodes match pattern like "SW1A 1AA", "B1 2NJ", "EC2A 4NE"
      const looksLikePostcode = lastPart && /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(lastPart);

      return {
        index: idx,
        companyName: r.companyName,
        companyNumber: r.companyNumber,
        status: r.status,
        address: r.address,
        postalCode: looksLikePostcode ? lastPart : null,
        sicCodes: null as string[] | null,
      };
    }
  );

  const matchResult = await tieredCompanyMatch(
    { companyName: installer.companyName, postcode: installer.postcode },
    chCandidates,
    aiMatchCompaniesHouse
  );

  if (matchResult.matched && matchResult.matchIndex != null && matchResult.confidence !== "low") {
    const match = results[matchResult.matchIndex];
    await db
      .update(installers)
      .set({
        legalEntityName: match.companyName,
        legalEntityNumber: match.companyNumber,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(installers.id, installerId));

    return NextResponse.json({
      autoMatched: true,
      match,
      matchTier: matchResult.tier,
      matchConfidence: matchResult.confidence,
      matchReasoning: matchResult.reasoning,
      similarityScore: matchResult.similarityScore,
      results,
    });
  }

  return NextResponse.json({
    autoMatched: false,
    matchTier: matchResult.tier,
    matchConfidence: matchResult.confidence,
    matchReasoning: matchResult.reasoning,
    similarityScore: matchResult.similarityScore,
    suggestedIndex: matchResult.matched ? matchResult.matchIndex : null,
    results,
  });
}
