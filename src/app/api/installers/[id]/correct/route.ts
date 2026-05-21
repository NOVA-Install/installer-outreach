import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// POST: Correct enrichment data by providing the right lookup key
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  const body = await request.json();
  const { source, action } = body;

  // --- Delete wrong data ---
  if (action === "delete") {
    if (source === "google") {
      await db.delete(googleReviews).where(eq(googleReviews.installerId, installerId));
      return NextResponse.json({ ok: true, message: "Google review data deleted" });
    }
    if (source === "trustpilot") {
      await db.delete(trustpilotReviews).where(eq(trustpilotReviews.installerId, installerId));
      return NextResponse.json({ ok: true, message: "Trustpilot data deleted" });
    }
    if (source === "companies_house") {
      await db.delete(companiesHouseData).where(eq(companiesHouseData.installerId, installerId));
      await db.update(installers).set({
        legalEntityName: null,
        legalEntityNumber: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(installers.id, installerId));
      return NextResponse.json({ ok: true, message: "Companies House data deleted" });
    }
    return NextResponse.json({ error: "Unknown source" }, { status: 400 });
  }

  // --- Correct Trustpilot by domain ---
  if (source === "trustpilot") {
    const { domain } = body;
    if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

    // Clean the domain
    let cleanDomain = domain.trim()
      .replace(/^https?:\/\/(www\.)?trustpilot\.com\/review\//, "")
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");

    // Fetch from Trustpilot page to get the actual rating
    try {
      const tpUrl = `https://www.trustpilot.com/review/${cleanDomain}`;
      const res = await fetch(tpUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InstallerTracker/1.0)" },
      });

      if (!res.ok) {
        return NextResponse.json({ error: `Trustpilot page not found for ${cleanDomain}` }, { status: 404 });
      }

      const html = await res.text();

      // Extract rating from JSON-LD or meta tags
      let rating: number | null = null;
      let reviewCount: number | null = null;
      let trustScore: number | null = null;

      // Try JSON-LD first
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (jsonLdMatch) {
        try {
          const ld = JSON.parse(jsonLdMatch[1]);
          if (ld.aggregateRating) {
            rating = parseFloat(ld.aggregateRating.ratingValue) || null;
            reviewCount = parseInt(ld.aggregateRating.reviewCount) || null;
          }
        } catch { /* ignore parse errors */ }
      }

      // Fallback: extract from meta/data attributes
      if (!rating) {
        const ratingMatch = html.match(/data-rating="([\d.]+)"/);
        if (ratingMatch) rating = parseFloat(ratingMatch[1]);
      }
      if (!reviewCount) {
        const countMatch = html.match(/(\d[\d,]*)\s*reviews?/i);
        if (countMatch) reviewCount = parseInt(countMatch[1].replace(/,/g, ""));
      }

      // Trust score from page
      const trustMatch = html.match(/TrustScore\s*([\d.]+)/);
      if (trustMatch) trustScore = parseFloat(trustMatch[1]);

      // Delete old and insert new
      await db.delete(trustpilotReviews).where(eq(trustpilotReviews.installerId, installerId));
      await db.insert(trustpilotReviews).values({
        installerId,
        trustpilotUrl: tpUrl,
        rating: rating || trustScore,
        reviewCount: reviewCount || 0,
        trustScore,
        fetchedAt: new Date().toISOString(),
      });

      return NextResponse.json({
        ok: true,
        message: `Updated Trustpilot: ${cleanDomain}, rating: ${rating || trustScore}, ${reviewCount || 0} reviews`,
        data: { domain: cleanDomain, rating: rating || trustScore, reviewCount, trustScore },
      });
    } catch (err) {
      return NextResponse.json({ error: `Failed to fetch Trustpilot: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  // --- Correct Companies House by company number ---
  if (source === "companies_house") {
    const { companyNumber } = body;
    if (!companyNumber) return NextResponse.json({ error: "companyNumber is required" }, { status: 400 });

    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "COMPANIES_HOUSE_API_KEY not set" }, { status: 500 });

    const auth = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

    try {
      const profileRes = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber.trim()}`, {
        headers: { Authorization: auth },
      });
      if (!profileRes.ok) {
        return NextResponse.json({ error: `Company ${companyNumber} not found` }, { status: 404 });
      }
      const profile = await profileRes.json();

      // Fetch officers
      const officersRes = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber.trim()}/officers?items_per_page=50`, {
        headers: { Authorization: auth },
      });
      const officersData = officersRes.ok ? await officersRes.json() : null;

      // Fetch PSC
      const pscRes = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber.trim()}/persons-with-significant-control`, {
        headers: { Authorization: auth },
      });
      const pscData = pscRes.ok ? await pscRes.json() : null;

      const officers = officersData?.items?.map(
        (o: { name: string; officer_role: string; appointed_on?: string; resigned_on?: string }) => ({
          name: o.name, role: o.officer_role, appointedOn: o.appointed_on || null, resignedOn: o.resigned_on || null,
        })
      ) || [];

      const psc = pscData?.items?.map(
        (p: { name?: string; natures_of_control?: string[] }) => ({
          name: p.name, naturesOfControl: p.natures_of_control || [],
        })
      ) || [];

      // Delete old and insert new
      await db.delete(companiesHouseData).where(eq(companiesHouseData.installerId, installerId));
      await db.insert(companiesHouseData).values({
        installerId,
        companyNumber: profile.company_number,
        companyStatus: profile.company_status,
        incorporationDate: profile.date_of_creation,
        companyType: profile.type,
        sicCodes: profile.sic_codes ? JSON.stringify(profile.sic_codes) : null,
        registeredAddress: profile.registered_office_address
          ? [profile.registered_office_address.address_line_1, profile.registered_office_address.address_line_2, profile.registered_office_address.locality, profile.registered_office_address.postal_code].filter(Boolean).join(", ")
          : null,
        lastAccountsDate: profile.accounts?.last_accounts?.made_up_to || null,
        accountCategory: profile.accounts?.last_accounts?.type || null,
        employeeCount: null,
        officers: officers.length > 0 ? JSON.stringify(officers) : null,
        personsOfControl: psc.length > 0 ? JSON.stringify(psc) : null,
        latestAccountsUrl: `https://find-and-update.company-information.service.gov.uk/company/${profile.company_number}/filing-history`,
        latestAccountsType: null,
        hasInsolvencyHistory: profile.has_insolvency_history ?? false,
        hasCharges: false,
        chargesCount: 0,
        fetchedAt: new Date().toISOString(),
      });

      // Update legal entity on installer
      await db.update(installers).set({
        legalEntityName: profile.company_name,
        legalEntityNumber: profile.company_number,
        updatedAt: new Date().toISOString(),
      }).where(eq(installers.id, installerId));

      return NextResponse.json({
        ok: true,
        message: `Updated Companies House: ${profile.company_name} (${profile.company_number})`,
        data: { companyName: profile.company_name, companyNumber: profile.company_number, status: profile.company_status },
      });
    } catch (err) {
      return NextResponse.json({ error: `Failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  // --- Correct Google Reviews by re-searching with custom query ---
  if (source === "google") {
    const { placeId, searchQuery } = body;

    // If placeId provided, we can't directly fetch from DataForSEO with just a place ID
    // But we can delete the wrong data so the user can re-run enrichment
    if (placeId) {
      await db.delete(googleReviews).where(eq(googleReviews.installerId, installerId));
      // Update the place_id reference for future enrichment
      return NextResponse.json({
        ok: true,
        message: "Google review data cleared. Re-run Google Reviews enrichment for this installer to fetch new data.",
      });
    }

    if (searchQuery) {
      await db.delete(googleReviews).where(eq(googleReviews.installerId, installerId));
      return NextResponse.json({
        ok: true,
        message: "Google review data cleared. Re-run enrichment to search again.",
      });
    }

    return NextResponse.json({ error: "Provide placeId or searchQuery" }, { status: 400 });
  }

  return NextResponse.json({ error: "Unknown source" }, { status: 400 });
}
