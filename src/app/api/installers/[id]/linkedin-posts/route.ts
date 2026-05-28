import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { linkedinContacts, socialSignals, installers } from "@/lib/db/schema";
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

  const body = await request.json().catch(() => ({}));
  const postedLimit = body.postedLimit || "month";

  try {
  // Get all known contacts for this installer
  const contacts = await db
    .select()
    .from(linkedinContacts)
    .where(eq(linkedinContacts.installerId, installerId));

  if (contacts.length === 0) {
    return NextResponse.json({ error: "No contacts found. Run 'Scrape Employees' first." }, { status: 404 });
  }

  // Build list of profile URLs/identifiers to scrape
  const profileUrls = contacts
    .filter((c) => c.profileUrl || c.publicIdentifier)
    .map((c) => c.profileUrl || `https://www.linkedin.com/in/${c.publicIdentifier}`);

  if (profileUrls.length === 0) {
    return NextResponse.json({ error: "No contacts with LinkedIn profile URLs" }, { status: 404 });
  }

  const client = new ApifyClient({ token });

  // Start the actor run
  const run = await client.actor("harvestapi/linkedin-profile-posts").start({
    profileUrls,
    scrapePostedLimit: postedLimit,
    maxPosts: 10, // per profile
  });

  // Poll for completion
  const runClient = client.run(run.id);
  const maxWaitMs = 50000;
  const pollInterval = 3000;
  const startTime = Date.now();

  let finished = false;
  while (Date.now() - startTime < maxWaitMs) {
    const status = await runClient.get();
    if (status?.status === "SUCCEEDED") { finished = true; break; }
    if (status?.status === "FAILED" || status?.status === "ABORTED") {
      return NextResponse.json({ error: `Actor run ${status.status}` }, { status: 500 });
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  if (!finished) {
    return NextResponse.json({ error: "Timed out waiting for Apify. Try again — the run may still complete." }, { status: 504 });
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // Build contact lookup by profile identifier
  const contactByIdentifier = new Map<string, typeof contacts[0]>();
  for (const c of contacts) {
    if (c.publicIdentifier) contactByIdentifier.set(c.publicIdentifier.toLowerCase(), c);
    if (c.linkedinUrn) contactByIdentifier.set(c.linkedinUrn, c);
  }

  const now = new Date().toISOString();
  let newSignals = 0;

  for (const item of items) {
    const post = item as Record<string, unknown>;
    const postId = (post.id as string) || (post.urn as string);
    if (!postId) continue;

    const author = post.author as Record<string, unknown> | undefined;
    const engagement = post.engagement as Record<string, unknown> | undefined;
    const postedAt = post.postedAt as Record<string, unknown> | undefined;
    const avatar = author?.avatar as Record<string, unknown> | undefined;

    // Match to contact
    const authorUrn = (author?.urn as string) || "";
    const authorId = (author?.publicIdentifier as string) || "";
    const contact = contactByIdentifier.get(authorUrn) || contactByIdentifier.get(authorId.toLowerCase());

    // Update contact if found
    if (contact && author?.name) {
      await db
        .update(linkedinContacts)
        .set({
          name: author.name as string,
          headline: (author.info as string) || contact.headline,
          avatarUrl: (avatar?.url as string) || contact.avatarUrl,
          lastSeenAt: now,
        })
        .where(eq(linkedinContacts.id, contact.id));
    }

    try {
      await db
        .insert(socialSignals)
        .values({
          installerId,
          contactId: contact?.id ?? null,
          postId,
          postUrl: (post.linkedinUrl as string) || "",
          postText: ((post.content as string) || "").slice(0, 5000),
          authorName: (author?.name as string) || "",
          authorHeadline: (author?.info as string) || "",
          authorProfileUrl: (author?.linkedinUrl as string) || "",
          authorProfileId: (author?.publicIdentifier as string) || "",
          postedAt: (postedAt?.date as string) || "",
          postedAtTimestamp: (postedAt?.timestamp as number) ? Math.floor((postedAt!.timestamp as number) / 1000) : null,
          likes: (engagement?.likes as number) ?? null,
          comments: (engagement?.comments as number) ?? null,
          shares: (engagement?.shares as number) ?? null,
          reactions: (engagement as Record<string, unknown>)?.reactions ? JSON.stringify((engagement as Record<string, unknown>).reactions) : null,
          postImages: Array.isArray(post.postImages) && (post.postImages as unknown[]).length > 0
            ? JSON.stringify((post.postImages as Record<string, unknown>[]).map(i => ({ url: i.url, width: i.width, height: i.height })))
            : null,
          postVideo: (post.postVideo as Record<string, unknown>)?.videoUrl
            ? JSON.stringify(post.postVideo)
            : null,
          articleTitle: (post.article as Record<string, unknown>)?.title as string || null,
          articleLink: (post.article as Record<string, unknown>)?.link as string || null,
          matchedKeyword: null, // No keyword — scraped all posts
          signalType: post.repostId ? "repost" : "post",
          fetchedAt: now,
        })
        .onConflictDoNothing({ target: socialSignals.postId });
      newSignals++;
    } catch {
      // Constraint error — skip
    }
  }

  // Score relevance with Gemini for posts that don't have a score yet
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  let scored = 0;
  if (apiKey && newSignals > 0) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Get the installer name for context
      const [installer] = await db.select({ companyName: installers.companyName }).from(installers).where(eq(installers.id, installerId)).limit(1);

      // Get unscored signals for this installer
      const unscored = await db
        .select({ id: socialSignals.id, postText: socialSignals.postText, authorName: socialSignals.authorName })
        .from(socialSignals)
        .where(eq(socialSignals.installerId, installerId))
        .limit(50);

      const unscoredFiltered = unscored.filter((s) => s.postText && s.postText.length > 20);
      if (unscoredFiltered.length > 0) {
        const postsForAi = unscoredFiltered.map((s, i) => `[${i}] ${s.authorName}: ${s.postText!.slice(0, 500)}`).join("\n\n");

        const result = await model.generateContent(`You are analyzing LinkedIn posts from employees of "${installer?.companyName || "an installer company"}".

Score each post for its relevance as a SALES SIGNAL — meaning it indicates the company is active, growing, investing, hiring, or could be a good prospect for selling them marketing/software services.

For each post, return:
- score: 0-100 (0 = completely irrelevant personal post, 100 = strong buying signal like hiring, expanding, investing in marketing)
- reason: 1 sentence explaining why this score

Return JSON array: [{"index": 0, "score": 75, "reason": "Company is hiring, indicates growth"}]

Posts:
${postsForAi}`);

        const text = result.response.text();
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const scores = JSON.parse(match[0]) as { index: number; score: number; reason: string }[];
          for (const s of scores) {
            const signal = unscoredFiltered[s.index];
            if (signal) {
              await db
                .update(socialSignals)
                .set({ relevanceScore: s.score, relevanceReason: s.reason })
                .where(eq(socialSignals.id, signal.id));
              scored++;
            }
          }
        }
      }
    } catch (err) {
      console.error("[linkedin-posts] Gemini scoring failed:", err);
    }
  }

  return NextResponse.json({
    contactsSearched: profileUrls.length,
    postsFound: items.length,
    newSignals,
    scored,
  });
  } catch (err) {
    console.error("[linkedin-posts] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
