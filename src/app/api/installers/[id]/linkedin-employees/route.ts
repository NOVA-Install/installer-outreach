import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import { linkedinCompanyTracking, linkedinContacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  if (isNaN(installerId)) {
    return NextResponse.json({ error: "Invalid installer ID" }, { status: 400 });
  }

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not set" }, { status: 500 });
  }

  const [tracking] = await db
    .select()
    .from(linkedinCompanyTracking)
    .where(eq(linkedinCompanyTracking.installerId, installerId))
    .limit(1);

  if (!tracking?.linkedinUrl || tracking.companySlug === "__not_found__") {
    return NextResponse.json({ error: "No LinkedIn company page tracked" }, { status: 404 });
  }

  try {
    const client = new ApifyClient({ token });

    // Start the actor run
    const run = await client.actor("harvestapi/linkedin-company-employees").start({
      companies: [tracking.linkedinUrl],
      profileScraperMode: "Short ($4 per 1k)",
      maxItems: 100,
    });

    // Wait for the actor to finish using the client's built-in waitForFinish
    await client.run(run.id).waitForFinish({ waitSecs: 55 });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    const now = new Date().toISOString();
    let newContacts = 0;

    for (const item of items) {
      const employee = item as Record<string, unknown>;
      const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || (employee.fullName as string);
      if (!name) continue;

      const urn = (employee.id as string) || null;
      const publicIdentifier = (employee.publicIdentifier as string) || null;
      const linkedinUrl = (employee.linkedinUrl as string) || null;
      const headline = (employee.headline as string) || null;
      const avatar = employee.avatar as Record<string, unknown> | undefined;
      const avatarUrl = (avatar?.url as string) || null;

      if (!urn) continue;

      await db
        .insert(linkedinContacts)
        .values({
          installerId,
          linkedinUrn: urn,
          publicIdentifier,
          profileUrl: linkedinUrl,
          name,
          headline,
          avatarUrl,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [linkedinContacts.installerId, linkedinContacts.linkedinUrn],
          set: {
            name,
            headline,
            publicIdentifier,
            profileUrl: linkedinUrl,
            avatarUrl,
            lastSeenAt: now,
          },
        });
      newContacts++;
    }

    return NextResponse.json({
      employees: items.length,
      newContacts,
      companySlug: tracking.companySlug,
    });
  } catch (err) {
    console.error("[linkedin-employees] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
