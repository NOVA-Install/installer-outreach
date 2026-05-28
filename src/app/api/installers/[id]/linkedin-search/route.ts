import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import {
  installers,
  linkedinCompanyTracking,
  linkedinContacts,
  socialSignals,
  appSettings,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 120;

const DEFAULT_KEYWORDS = [
  "solar installation", "solar panel", "heat pump",
  "renewable energy installer", "MCS certified", "solar PV",
  "air source heat pump", "battery storage", "EV charger installation",
];

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

  // Get the company's LinkedIn slug
  const [tracking] = await db
    .select()
    .from(linkedinCompanyTracking)
    .where(eq(linkedinCompanyTracking.installerId, installerId))
    .limit(1);

  if (!tracking?.companySlug || tracking.companySlug === "__not_found__") {
    return NextResponse.json({ error: "No LinkedIn company page tracked for this installer" }, { status: 404 });
  }

  // Load keywords from database or use defaults
  let keywords = DEFAULT_KEYWORDS;
  const [setting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "linkedin_signal_keywords"))
    .limit(1);
  if (setting) {
    try {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed) && parsed.length > 0) keywords = parsed;
    } catch {}
  }

  const body = await request.json().catch(() => ({}));
  const postedLimit = body.postedLimit || "month";

  // Run Apify search for this single company
  const client = new ApifyClient({ token });
  const run = await client.actor("harvestapi/linkedin-post-search").call(
    {
      searchQueries: keywords,
      authorsCompanies: [tracking.companySlug],
      postedLimit,
      maxPosts: 50,
      scrapePages: 1,
    },
    { waitSecs: 120 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const now = new Date().toISOString();
  let newSignals = 0;

  for (const item of items) {
    const post = item as Record<string, unknown>;
    const postId = post.id as string;
    if (!postId) continue;

    const author = post.author as Record<string, unknown> | undefined;
    const engagement = post.engagement as Record<string, unknown> | undefined;
    const postedAt = post.postedAt as Record<string, unknown> | undefined;
    const avatar = author?.avatar as Record<string, unknown> | undefined;

    // Upsert contact
    let contactId: number | null = null;
    const authorUrn = author?.urn as string | undefined;
    const authorName = author?.name as string | undefined;
    if (authorUrn && authorName) {
      const [contact] = await db
        .insert(linkedinContacts)
        .values({
          installerId,
          linkedinUrn: authorUrn,
          publicIdentifier: (author?.publicIdentifier as string) || null,
          profileUrl: (author?.linkedinUrl as string) || null,
          name: authorName,
          headline: (author?.info as string) || null,
          avatarUrl: (avatar?.url as string) || null,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [linkedinContacts.installerId, linkedinContacts.linkedinUrn],
          set: {
            name: authorName,
            headline: (author?.info as string) || null,
            publicIdentifier: (author?.publicIdentifier as string) || null,
            profileUrl: (author?.linkedinUrl as string) || null,
            avatarUrl: (avatar?.url as string) || null,
            lastSeenAt: now,
          },
        })
        .returning({ id: linkedinContacts.id });
      contactId = contact?.id ?? null;
    }

    try {
      await db
        .insert(socialSignals)
        .values({
          installerId,
          contactId,
          postId,
          postUrl: (post.linkedinUrl as string) || "",
          postText: ((post.content as string) || "").slice(0, 5000),
          authorName: (author?.name as string) || "",
          authorHeadline: (author?.info as string) || "",
          authorProfileUrl: (author?.linkedinUrl as string) || "",
          authorProfileId: (author?.publicIdentifier as string) || "",
          postedAt: (postedAt?.date as string) || "",
          likes: (engagement?.likes as number) ?? null,
          comments: (engagement?.comments as number) ?? null,
          shares: (engagement?.shares as number) ?? null,
          signalType: post.repostId ? "repost" : "post",
          fetchedAt: now,
        })
        .onConflictDoNothing({ target: socialSignals.postId });
      newSignals++;
    } catch {}
  }

  // Update lastSearchedAt
  await db
    .update(linkedinCompanyTracking)
    .set({ lastSearchedAt: now })
    .where(eq(linkedinCompanyTracking.id, tracking.id));

  return NextResponse.json({
    searched: 1,
    postsFound: items.length,
    newSignals,
    companySlug: tracking.companySlug,
  });
}
