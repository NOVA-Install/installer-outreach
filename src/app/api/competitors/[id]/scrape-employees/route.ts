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

      // Upsert by competitor + profile URL to avoid duplicates
      if (profileUrl) {
        const existing = await db
          .select({ id: competitorEmployees.id })
          .from(competitorEmployees)
          .where(eq(competitorEmployees.profileUrl, profileUrl))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(competitorEmployees)
            .set({ fullName, headline, avatarUrl, role: jobTitle, lastSeenAt: now })
            .where(eq(competitorEmployees.id, existing[0].id));
        } else {
          await db.insert(competitorEmployees).values({
            competitorId,
            fullName,
            headline,
            profileUrl,
            avatarUrl,
            role: jobTitle,
            lastSeenAt: now,
          });
          inserted++;
        }
      } else {
        await db.insert(competitorEmployees).values({
          competitorId,
          fullName,
          headline,
          avatarUrl,
          role: jobTitle,
          lastSeenAt: now,
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
