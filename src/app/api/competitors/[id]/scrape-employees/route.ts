import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import { competitors, competitorEmployees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not set" }, { status: 500 });
  }

  const [competitor] = await db
    .select()
    .from(competitors)
    .where(eq(competitors.id, competitorId))
    .limit(1);

  if (!competitor) {
    return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  }

  if (!competitor.linkedinUrl) {
    return NextResponse.json({ error: "No LinkedIn URL set for this competitor" }, { status: 400 });
  }

  try {
    const client = new ApifyClient({ token });

    const run = await client.actor("harvestapi/linkedin-company-employees").start({
      companies: [competitor.linkedinUrl],
      profileScraperMode: "Short ($4 per 1k)",
      maxItems: 200,
    });

    await client.run(run.id).waitForFinish({ waitSecs: 55 });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    const now = new Date().toISOString();
    let inserted = 0;

    // Load existing employees for this competitor once so we can dedupe in
    // memory. LinkedIn returns the same person under different profile-URL
    // formats across scrapes (public vanity slug vs opaque URN), so matching
    // on exact URL alone misses duplicates — we also match on name.
    const existingEmployees = await db
      .select({
        id: competitorEmployees.id,
        fullName: competitorEmployees.fullName,
        profileUrl: competitorEmployees.profileUrl,
        headline: competitorEmployees.headline,
        avatarUrl: competitorEmployees.avatarUrl,
        role: competitorEmployees.role,
      })
      .from(competitorEmployees)
      .where(eq(competitorEmployees.competitorId, competitorId));

    for (const item of items) {
      const employee = item as Record<string, unknown>;
      const fullName =
        [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
        (employee.fullName as string);
      if (!fullName) continue;

      const profileUrl = (employee.linkedinUrl as string) || null;
      const headline = (employee.headline as string) || null;
      const avatarUrl = (employee.pictureUrl as string) || null;
      const positions = employee.currentPositions as Record<string, unknown>[] | undefined;
      const jobTitle = (positions?.[0]?.title as string) || null;

      // Match an existing row by exact profile URL, else by name (case-insensitive)
      const match = existingEmployees.find(
        (e) =>
          (profileUrl && e.profileUrl === profileUrl) ||
          e.fullName.toLowerCase() === fullName.toLowerCase()
      );

      if (match) {
        // Preserve existing values when this scrape didn't return them — the
        // "Short" scrape mode often omits the picture/headline, and we don't
        // want a re-scrape to wipe data a previous richer scrape captured.
        const mergedProfileUrl = profileUrl ?? match.profileUrl;
        const mergedHeadline = headline ?? match.headline;
        const mergedAvatarUrl = avatarUrl ?? match.avatarUrl;
        const mergedRole = jobTitle ?? match.role;

        await db
          .update(competitorEmployees)
          .set({
            fullName,
            headline: mergedHeadline,
            profileUrl: mergedProfileUrl,
            avatarUrl: mergedAvatarUrl,
            role: mergedRole,
            lastSeenAt: now,
          })
          .where(eq(competitorEmployees.id, match.id));

        // Reflect merged values locally so later items in this batch match too
        match.profileUrl = mergedProfileUrl;
        match.headline = mergedHeadline;
        match.avatarUrl = mergedAvatarUrl;
        match.role = mergedRole;
      } else {
        const [created] = await db
          .insert(competitorEmployees)
          .values({
            competitorId,
            fullName,
            headline,
            profileUrl,
            avatarUrl,
            role: jobTitle,
            lastSeenAt: now,
          })
          .returning({ id: competitorEmployees.id });
        existingEmployees.push({
          id: created.id,
          fullName,
          profileUrl,
          headline,
          avatarUrl,
          role: jobTitle,
        });
        inserted++;
      }
    }

    return NextResponse.json({
      total: items.length,
      new: inserted,
      competitor: competitor.name,
    });
  } catch (err) {
    console.error("[competitor-scrape-employees] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
