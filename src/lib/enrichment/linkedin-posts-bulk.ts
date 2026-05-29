import { ApifyClient } from "apify-client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import {
  installers,
  linkedinCompanyTracking,
  linkedinContacts,
  socialSignals,
  appSettings,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

const LINKEDIN_PROFILE_POSTS_ACTOR = "harvestapi/linkedin-profile-posts";

interface BulkPostsResult {
  processed: number;
  totalPosts: number;
  newSignals: number;
  scored: number;
  errors: number;
  remaining: number;
}

/**
 * Scrape LinkedIn posts for employees of shortlisted companies.
 * Processes one company per call to stay within Apify/timeout limits.
 */
export async function scrapeLinkedInPostsBatch(
  batchSize = 3
): Promise<BulkPostsResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  // Load user keywords once for matching + scoring
  let userKeywords: string[] = [];
  const [kwSetting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "linkedin_signal_keywords"))
    .limit(1);
  if (kwSetting) {
    try {
      userKeywords = JSON.parse(kwSetting.value);
    } catch {}
  }

  // Find shortlisted companies that have contacts but haven't had posts scraped,
  // or were last scraped more than 7 days ago
  const candidates = await db
    .select({
      installerId: installers.id,
      companyName: installers.companyName,
      trackingId: linkedinCompanyTracking.id,
      lastScrapedPostsAt: linkedinCompanyTracking.lastScrapedPostsAt,
    })
    .from(installers)
    .innerJoin(
      linkedinCompanyTracking,
      eq(installers.id, linkedinCompanyTracking.installerId)
    )
    .where(
      and(
        eq(installers.isShortlisted, true),
        sql`${linkedinCompanyTracking.companySlug} != '__not_found__'`,
        // Has at least one contact
        sql`EXISTS (
          SELECT 1 FROM linkedin_contacts lc
          WHERE lc.installer_id = ${installers.id}
        )`
      )
    )
    // Process never-scraped first, then oldest-scraped
    .orderBy(sql`${linkedinCompanyTracking.lastScrapedPostsAt} ASC NULLS FIRST`)
    .limit(batchSize);

  if (candidates.length === 0) {
    return { processed: 0, totalPosts: 0, newSignals: 0, scored: 0, errors: 0, remaining: 0 };
  }

  // Count remaining
  const [{ count: remainingCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(installers)
    .innerJoin(
      linkedinCompanyTracking,
      eq(installers.id, linkedinCompanyTracking.installerId)
    )
    .where(
      and(
        eq(installers.isShortlisted, true),
        sql`${linkedinCompanyTracking.companySlug} != '__not_found__'`,
        sql`EXISTS (
          SELECT 1 FROM linkedin_contacts lc
          WHERE lc.installer_id = ${installers.id}
        )`
      )
    );

  const client = new ApifyClient({ token });
  let totalProcessed = 0;
  let totalPosts = 0;
  let totalNewSignals = 0;
  let totalScored = 0;
  let totalErrors = 0;

  for (const candidate of candidates) {
    try {
      console.log(
        `[linkedin-posts-bulk] Scraping posts for ${candidate.companyName} (installer ${candidate.installerId})`
      );

      // Get contacts for this installer
      const contacts = await db
        .select()
        .from(linkedinContacts)
        .where(eq(linkedinContacts.installerId, candidate.installerId));

      const profileUrls = contacts
        .filter((c) => c.profileUrl || c.publicIdentifier)
        .map(
          (c) =>
            c.profileUrl ||
            `https://www.linkedin.com/in/${c.publicIdentifier}`
        );

      if (profileUrls.length === 0) {
        totalProcessed++;
        continue;
      }

      // Determine date range
      const postedLimit = candidate.lastScrapedPostsAt ? undefined : "month";
      const postedLimitDate = candidate.lastScrapedPostsAt || undefined;

      const run = await client.actor(LINKEDIN_PROFILE_POSTS_ACTOR).start({
        targetUrls: profileUrls,
        ...(postedLimitDate
          ? { postedLimitDate }
          : { postedLimit: postedLimit || "month" }),
        maxPosts: 10,
      });

      await client.run(run.id).waitForFinish({ waitSecs: 120 });

      const { items } = await client
        .dataset(run.defaultDatasetId)
        .listItems();

      totalPosts += items.length;

      // Build contact lookup
      const contactByIdentifier = new Map<string, (typeof contacts)[0]>();
      for (const c of contacts) {
        if (c.publicIdentifier)
          contactByIdentifier.set(c.publicIdentifier.toLowerCase(), c);
        if (c.linkedinUrn) contactByIdentifier.set(c.linkedinUrn, c);
      }

      const now = new Date().toISOString();
      let newSignals = 0;

      for (const item of items) {
        const post = item as Record<string, unknown>;
        const postId = (post.id as string) || (post.urn as string);
        if (!postId) continue;

        const author = post.author as Record<string, unknown> | undefined;
        const engagement = post.engagement as
          | Record<string, unknown>
          | undefined;
        const postedAt = post.postedAt as Record<string, unknown> | undefined;
        const avatar = author?.avatar as Record<string, unknown> | undefined;

        // Match to contact
        const authorUrn = (author?.urn as string) || "";
        const authorId = (author?.publicIdentifier as string) || "";
        const contact =
          contactByIdentifier.get(authorUrn) ||
          contactByIdentifier.get(authorId.toLowerCase());

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
          const postText = ((post.content as string) || "").slice(0, 5000);
          // Skip duplicate content
          if (postText.length > 20) {
            const [existing] = await db
              .select({ id: socialSignals.id })
              .from(socialSignals)
              .where(
                sql`${socialSignals.installerId} = ${candidate.installerId} AND LEFT(${socialSignals.postText}, 200) = LEFT(${postText}, 200)`
              )
              .limit(1);
            if (existing) continue;
          }

          await db
            .insert(socialSignals)
            .values({
              installerId: candidate.installerId,
              contactId: contact?.id ?? null,
              postId,
              postUrl: (post.linkedinUrl as string) || "",
              postText,
              authorName: (author?.name as string) || "",
              authorHeadline: (author?.info as string) || "",
              authorProfileUrl: (author?.linkedinUrl as string) || "",
              authorProfileId: (author?.publicIdentifier as string) || "",
              postedAt: (postedAt?.date as string) || "",
              postedAtTimestamp: (postedAt?.timestamp as number)
                ? Math.floor((postedAt!.timestamp as number) / 1000)
                : null,
              likes: (engagement?.likes as number) ?? null,
              comments: (engagement?.comments as number) ?? null,
              shares: (engagement?.shares as number) ?? null,
              reactions: (engagement as Record<string, unknown>)?.reactions
                ? JSON.stringify(
                    (engagement as Record<string, unknown>).reactions
                  )
                : null,
              postImages:
                Array.isArray(post.postImages) &&
                (post.postImages as unknown[]).length > 0
                  ? JSON.stringify(
                      (post.postImages as Record<string, unknown>[]).map(
                        (i) => ({
                          url: i.url,
                          width: i.width,
                          height: i.height,
                        })
                      )
                    )
                  : null,
              postVideo: (post.postVideo as Record<string, unknown>)?.videoUrl
                ? JSON.stringify(post.postVideo)
                : null,
              articleTitle:
                ((post.article as Record<string, unknown>)?.title as string) ||
                null,
              articleLink:
                ((post.article as Record<string, unknown>)?.link as string) ||
                null,
              matchedKeyword:
                userKeywords.find((kw) =>
                  postText.toLowerCase().includes(kw.toLowerCase())
                ) || null,
              signalType: post.repostId ? "repost" : "post",
              fetchedAt: now,
            })
            .onConflictDoNothing({ target: socialSignals.postId });
          newSignals++;
        } catch {
          // Constraint error — skip
        }
      }

      totalNewSignals += newSignals;

      // Score with Gemini
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (apiKey && newSignals > 0) {
        try {
          const scored = await scorePostsWithGemini(
            apiKey,
            candidate.installerId,
            candidate.companyName,
            userKeywords
          );
          totalScored += scored;
        } catch (err) {
          console.error(
            `[linkedin-posts-bulk] Gemini scoring failed for ${candidate.companyName}:`,
            err
          );
        }
      }

      // Update last scraped timestamp
      await db
        .update(linkedinCompanyTracking)
        .set({ lastScrapedPostsAt: new Date().toISOString() })
        .where(eq(linkedinCompanyTracking.id, candidate.trackingId));

      totalProcessed++;
      console.log(
        `[linkedin-posts-bulk] ${candidate.companyName}: ${items.length} posts, ${newSignals} new signals`
      );
    } catch (err) {
      console.error(
        `[linkedin-posts-bulk] Failed for ${candidate.companyName}:`,
        err instanceof Error ? err.message : err
      );
      totalErrors++;
    }
  }

  return {
    processed: totalProcessed,
    totalPosts,
    newSignals: totalNewSignals,
    scored: totalScored,
    errors: totalErrors,
    remaining: Math.max(0, Number(remainingCount) - candidates.length),
  };
}

async function scorePostsWithGemini(
  apiKey: string,
  installerId: number,
  companyName: string,
  userKeywords: string[]
): Promise<number> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const unscored = await db
    .select({
      id: socialSignals.id,
      postText: socialSignals.postText,
      authorName: socialSignals.authorName,
    })
    .from(socialSignals)
    .where(
      sql`${socialSignals.installerId} = ${installerId} AND ${socialSignals.relevanceScore} IS NULL`
    )
    .limit(50);

  const filtered = unscored.filter((s) => s.postText && s.postText.length > 20);
  if (filtered.length === 0) return 0;

  const postsForAi = filtered
    .map((s, i) => `[${i}] ${s.authorName}: ${s.postText!.slice(0, 500)}`)
    .join("\n\n");

  const keywordContext =
    userKeywords.length > 0
      ? `\n\nThe user tracks these keywords: ${userKeywords.join(", ")}.`
      : "";

  const result = await model.generateContent(
    `You are scoring LinkedIn posts from employees of "${companyName}". The user sells marketing, lead generation, and software services to these companies.

HIGH SCORE (70-100): The post shows the company is:
- Actively looking for leads, buying leads, or wanting more customers
- Interested in working with a marketing agency, growth agency, or lead gen company
- Looking for software to improve operations (CRM, quoting tools, etc.)
- Asking for help growing their business
- Complaining about lead quality or needing better leads

MEDIUM SCORE (30-69): The post shows:
- The company is hiring sales/marketing staff (they might want to outsource instead)
- Expanding into new areas or services (growth signal)
- Running their own marketing campaigns (might need help scaling)

LOW SCORE (0-29): The post is:
- Just showcasing completed work or projects (normal business activity)
- Personal content unrelated to business needs
- Looking for installers/tradespeople to do physical work (user can't help with this)
- General industry commentary without buying intent
- Employee appreciation or team posts${keywordContext}

For each post return: score (0-100) and reason (1 sentence).
Return JSON array: [{"index": 0, "score": 75, "reason": "Actively seeking lead generation partners"}]

Posts:
${postsForAi}`
  );

  const text = result.response.text();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return 0;

  let scored = 0;
  const scores = JSON.parse(match[0]) as {
    index: number;
    score: number;
    reason: string;
  }[];

  for (const s of scores) {
    const signal = filtered[s.index];
    if (signal) {
      await db
        .update(socialSignals)
        .set({ relevanceScore: s.score, relevanceReason: s.reason })
        .where(eq(socialSignals.id, signal.id));
      scored++;
    }
  }

  return scored;
}

/**
 * Preview: count eligible shortlisted companies for post scraping
 */
export async function previewLinkedInPostsBulk() {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE i.is_shortlisted = true
          AND lct.company_slug != '__not_found__'
          AND EXISTS (
            SELECT 1 FROM linkedin_contacts lc WHERE lc.installer_id = i.id
          )
      ) as eligible,
      COUNT(*) FILTER (
        WHERE i.is_shortlisted = true
          AND EXISTS (
            SELECT 1 FROM linkedin_contacts lc WHERE lc.installer_id = i.id
          )
      ) as total_with_contacts,
      (SELECT COUNT(DISTINCT lc.installer_id) FROM linkedin_contacts lc
       JOIN installers si ON si.id = lc.installer_id AND si.is_shortlisted = true
      ) as shortlisted_with_contacts
    FROM installers i
    LEFT JOIN linkedin_company_tracking lct ON i.id = lct.installer_id
  `);

  const row = (result as unknown as Record<string, unknown>[])[0] || {};

  return {
    eligible: Number(row.eligible || 0),
    totalWithContacts: Number(row.total_with_contacts || 0),
    estimatedCost: `~$${(Number(row.eligible || 0) * 0.02).toFixed(2)}`,
  };
}
