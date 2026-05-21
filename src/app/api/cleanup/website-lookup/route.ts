import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers } from "@/lib/db/schema";
import { eq, isNull, sql, and, or } from "drizzle-orm";

// GET: list installers without a website
export async function GET() {
  const missing = await db
    .select({
      id: installers.id,
      companyName: installers.companyName,
      postcode: installers.postcode,
      website: installers.website,
      websiteStatus: installers.websiteStatus,
    })
    .from(installers)
    .where(
      and(
        or(isNull(installers.website), sql`${installers.website} = ''`),
        or(isNull(installers.websiteStatus), sql`${installers.websiteStatus} != 'not_found'`)
      )
    )
    .orderBy(installers.companyName)
    .limit(100);

  const stats = await db
    .select({
      total: sql<number>`count(*)`,
      withWebsite: sql<number>`count(case when website is not null and website != '' then 1 end)`,
      notFound: sql<number>`count(case when website_status = 'not_found' then 1 end)`,
      pendingReview: sql<number>`count(case when website_status = 'pending_review' then 1 end)`,
    })
    .from(installers);

  return NextResponse.json({ missing, stats: stats[0] });
}

// POST: lookup or update website
export async function POST(request: NextRequest) {
  const { installerId, action, website } = await request.json();

  // Set website
  if (action === "set_website") {
    await db
      .update(installers)
      .set({
        website: website,
        websiteStatus: "found",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(installers.id, installerId));
    return NextResponse.json({ ok: true });
  }

  // Mark as not found
  if (action === "not_found") {
    await db
      .update(installers)
      .set({
        websiteStatus: "not_found",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(installers.id, installerId));
    return NextResponse.json({ ok: true });
  }

  // Lookup via DataForSEO SERP
  if (action === "lookup") {
    const dfsLogin = process.env.DATAFORSEO_LOGIN;
    const dfsPassword = process.env.DATAFORSEO_PASSWORD;
    if (!dfsLogin || !dfsPassword) {
      return NextResponse.json({ error: "DATAFORSEO credentials not set" }, { status: 500 });
    }

    const [installer] = await db
      .select({ companyName: installers.companyName, postcode: installers.postcode })
      .from(installers)
      .where(eq(installers.id, installerId))
      .limit(1);

    if (!installer) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const auth = "Basic " + Buffer.from(`${dfsLogin}:${dfsPassword}`).toString("base64");
    const searchQuery = `${installer.companyName} ${installer.postcode || ""} solar installer`.trim();

    const res = await fetch(
      "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
      {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            keyword: searchQuery,
            location_name: "United Kingdom",
            language_name: "English",
            depth: 10,
          },
        ]),
      }
    );

    const data = await res.json();

    if (data.status_code !== 20000) {
      return NextResponse.json(
        { error: `API error ${data.status_code}: ${data.status_message}` },
        { status: 502 }
      );
    }

    const items = data?.tasks?.[0]?.result?.[0]?.items || [];
    const cost = data?.tasks?.[0]?.cost || 0;

    const skipDomains = [
      "trustpilot.com", "facebook.com", "twitter.com", "linkedin.com",
      "instagram.com", "yell.com", "checkatrade.com", "google.com",
      "yelp.com", "which.co.uk", "youtube.com", "gov.uk", "x.com",
      "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk",
      "bark.com", "mybuilder.com", "wikipedia.org", "amazon.co.uk",
      "tiktok.com", "pinterest.com", "nextdoor.co.uk",
    ];

    const suggestions = items
      .filter((item: { type?: string; domain?: string }) =>
        item.type === "organic" && item.domain && !skipDomains.some((s) => item.domain!.includes(s))
      )
      .map((item: { domain: string; title?: string; url?: string }) => ({
        domain: item.domain,
        title: item.title,
        url: item.url,
      }))
      // Deduplicate by domain
      .filter(
        (item: { domain: string }, index: number, arr: { domain: string }[]) =>
          arr.findIndex((a) => a.domain === item.domain) === index
      )
      .slice(0, 8);

    // Mark as pending review
    await db
      .update(installers)
      .set({ websiteStatus: "pending_review", updatedAt: new Date().toISOString() })
      .where(eq(installers.id, installerId));

    return NextResponse.json({
      suggestions,
      searchQuery,
      cost,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
