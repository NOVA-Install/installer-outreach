import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import {
  installers,
  marketingSignals,
  linkedinCompanyTracking,
  linkedinContacts,
  socialSignals,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, isNull, isNotNull, sql, and } from "drizzle-orm";

// ── Apify actor ID ───────────────────────────────────────────────
const LINKEDIN_POST_SEARCH_ACTOR = "harvestapi/linkedin-post-search";

// ── Keywords to search for installer-relevant LinkedIn activity ──
const SEARCH_KEYWORDS = [
  "solar installation",
  "solar panel",
  "heat pump",
  "renewable energy installer",
  "MCS certified",
  "solar PV",
  "air source heat pump",
  "battery storage",
  "EV charger installation",
];

// Slugs that belong to site builders, platforms, etc. — not real installer companies
const BLOCKED_SLUGS = new Set([
  "squarespace", "wix-com", "wix", "wordpress", "wordpress-com", "godaddy",
  "facebook", "google", "linkedin", "twitter", "instagram", "youtube",
  "hubspot", "mailchimp", "shopify", "weebly", "jimdo", "ionos",
  "tawk-to", "zendesk", "intercom", "drift", "crisp",
  "trustpilot", "yell", "checkatrade", "mybuilder",
  "apple", "microsoft", "amazon", "netflix",
]);

function getApifyClient() {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN env var not set");
  return new ApifyClient({ token });
}

/**
 * Extracts the company slug from a LinkedIn company URL.
 * e.g. "https://www.linkedin.com/company/acme-solar/" → "acme-solar"
 */
function extractSlug(linkedinUrl: string): string | null {
  const match = linkedinUrl.match(
    /linkedin\.com\/company\/([a-zA-Z0-9._&-]+)/i
  );
  return match ? match[1].toLowerCase().replace(/\/$/, "") : null;
}

// ── Step 1: Sync LinkedIn URLs from marketingSignals into tracking table ──

export async function syncLinkedInUrls(): Promise<{ synced: number }> {
  const rows = await db
    .select({
      installerId: marketingSignals.installerId,
      linkedinUrl: marketingSignals.linkedinUrl,
    })
    .from(marketingSignals)
    .leftJoin(
      linkedinCompanyTracking,
      eq(marketingSignals.installerId, linkedinCompanyTracking.installerId)
    )
    .where(
      and(
        isNotNull(marketingSignals.linkedinUrl),
        isNull(linkedinCompanyTracking.id)
      )
    )
    .limit(5000);

  if (rows.length === 0) return { synced: 0 };

  const values = rows
    .map((r) => {
      const slug = extractSlug(r.linkedinUrl!);
      if (!slug || BLOCKED_SLUGS.has(slug)) return null;
      return { installerId: r.installerId, linkedinUrl: r.linkedinUrl!, companySlug: slug };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (values.length === 0) return { synced: 0 };

  await db.insert(linkedinCompanyTracking).values(values);
  return { synced: values.length };
}

// ── Step 2: Search LinkedIn posts filtered by company employees ──

// Type for the HarvestAPI post search output (PostShort schema)
interface LinkedInPostResult {
  id: string;
  content?: string;
  linkedinUrl?: string;
  author?: {
    id?: string;
    urn?: string;
    publicIdentifier?: string;
    universalName?: string;
    name?: string;
    linkedinUrl?: string;
    info?: string; // headline — may or may not contain company name
    avatar?: { url?: string };
  };
  postedAt?: {
    timestamp?: number;
    date?: string;
    postedAgoShort?: string;
    postedAgoText?: string;
  };
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
  repostId?: string | null;
  // The query object is echoed back in each result — includes which companies were filtered
  query?: {
    authorsCompany?: string[];
    search?: string;
  };
}

/**
 * Searches for recent LinkedIn posts by employees of tracked companies.
 *
 * Each result includes a `query.authorsCompany` array echoing back
 * which company slugs were used in the filter. We use this for
 * attribution — if only one slug in the query, attribution is certain.
 * For multi-slug batches, we match the slug back to our tracking table.
 */
export async function searchLinkedInPosts(options?: {
  companyBatchSize?: number;
  keywords?: string[];
  postedLimit?: string;
  maxPostsPerBatch?: number;
  maxCompanies?: number;
}): Promise<{ processed: number; errors: number; newSignals: number }> {
  const {
    companyBatchSize = 1,
    keywords = SEARCH_KEYWORDS,
    postedLimit = "week",
    maxPostsPerBatch = 100,
    maxCompanies,
  } = options ?? {};

  // Get tracked companies with slugs, optionally limited
  const query = db
    .select({
      installerId: linkedinCompanyTracking.installerId,
      companySlug: linkedinCompanyTracking.companySlug,
      linkedinUrl: linkedinCompanyTracking.linkedinUrl,
      companyName: installers.companyName,
      trackingId: linkedinCompanyTracking.id,
    })
    .from(linkedinCompanyTracking)
    .innerJoin(installers, eq(linkedinCompanyTracking.installerId, installers.id))
    .where(and(
      isNotNull(linkedinCompanyTracking.companySlug),
      sql`${linkedinCompanyTracking.companySlug} != '__not_found__'`
    ));

  if (maxCompanies) {
    query.limit(maxCompanies);
  }

  const tracked = await query;

  if (tracked.length === 0) {
    return { processed: 0, errors: 0, newSignals: 0 };
  }

  const client = getApifyClient();
  let totalProcessed = 0;
  let totalErrors = 0;
  let totalNewSignals = 0;

  // Batch companies into small groups for accurate attribution
  const batches: typeof tracked[] = [];
  for (let i = 0; i < tracked.length; i += companyBatchSize) {
    batches.push(tracked.slice(i, i + companyBatchSize));
  }

  for (const batch of batches) {
    const slugs = batch.map((c) => c.companySlug!);

    try {
      const run = await client.actor(LINKEDIN_POST_SEARCH_ACTOR).call(
        {
          searchQueries: keywords,
          authorsCompanies: slugs,
          postedLimit,
          maxPosts: maxPostsPerBatch,
          scrapePages: 1, // Stop after first page — prevents 10+ empty page fetches per query
        },
        { waitSecs: 300 }
      );

      const { items } = await client
        .dataset(run.defaultDatasetId)
        .listItems();

      const now = new Date().toISOString();
      let batchNew = 0;

      // Build slug → installerId lookup for this batch
      const slugToInstaller = new Map<string, number>();
      for (const company of batch) {
        if (company.companySlug) {
          slugToInstaller.set(company.companySlug.toLowerCase(), company.installerId);
        }
      }

      for (const item of items) {
        const post = item as unknown as LinkedInPostResult;
        if (!post.id) continue;

        // Attribute using query.authorsCompany echoed in the response
        const installerId = matchPostToInstaller(post, slugToInstaller, batch);
        if (!installerId) continue;

        try {
          // Upsert contact — build up contact list organically from posts
          let contactId: number | null = null;
          const authorUrn = post.author?.urn;
          const authorName = post.author?.name;
          if (authorUrn && authorName) {
            const [contact] = await db
              .insert(linkedinContacts)
              .values({
                installerId,
                linkedinUrn: authorUrn,
                publicIdentifier: post.author?.publicIdentifier || null,
                profileUrl: post.author?.linkedinUrl || null,
                name: authorName,
                headline: post.author?.info || null,
                avatarUrl: post.author?.avatar?.url || null,
                firstSeenAt: now,
                lastSeenAt: now,
              })
              .onConflictDoUpdate({
                target: [linkedinContacts.installerId, linkedinContacts.linkedinUrn],
                set: {
                  name: authorName,
                  headline: post.author?.info || null,
                  publicIdentifier: post.author?.publicIdentifier || null,
                  profileUrl: post.author?.linkedinUrl || null,
                  avatarUrl: post.author?.avatar?.url || null,
                  lastSeenAt: now,
                },
              })
              .returning({ id: linkedinContacts.id });
            contactId = contact?.id ?? null;
          }

          await db
            .insert(socialSignals)
            .values({
              installerId,
              contactId,
              postId: post.id,
              postUrl: post.linkedinUrl || "",
              postText: (post.content || "").slice(0, 5000),
              authorName: post.author?.name || "",
              authorHeadline: post.author?.info || "",
              authorProfileUrl: post.author?.linkedinUrl || "",
              authorProfileId: post.author?.publicIdentifier || "",
              postedAt: post.postedAt?.date || "",
              likes: post.engagement?.likes ?? null,
              comments: post.engagement?.comments ?? null,
              shares: post.engagement?.shares ?? null,
              signalType: post.repostId ? "repost" : "post",
              fetchedAt: now,
            })
            .onConflictDoNothing({ target: socialSignals.postId });
          batchNew++;
        } catch {
          // Constraint error — skip
        }
      }

      // Update lastSearchedAt for all companies in this batch
      for (const company of batch) {
        await db
          .update(linkedinCompanyTracking)
          .set({ lastSearchedAt: now })
          .where(eq(linkedinCompanyTracking.id, company.trackingId));
      }

      totalProcessed += items.length;
      totalNewSignals += batchNew;
    } catch (err) {
      console.error(`Apify post search failed for batch [${slugs.join(", ")}]:`, err);
      totalErrors++;
    }
  }

  return { processed: totalProcessed, errors: totalErrors, newSignals: totalNewSignals };
}

/**
 * Match a post to an installer using the `query.authorsCompany` field
 * echoed back in each result. This tells us exactly which company slugs
 * were in the filter that produced this result.
 *
 * If the query had only one slug, attribution is certain.
 * If multiple slugs, we still know the result came from one of them —
 * and since each Apify run uses one batch of slugs, we can match directly.
 */
function matchPostToInstaller(
  post: LinkedInPostResult,
  slugToInstaller: Map<string, number>,
  batch: { installerId: number; companySlug: string | null; companyName: string }[]
): number | null {
  // If batch has only 1 company, attribution is certain
  if (batch.length === 1) return batch[0].installerId;

  // Use query.authorsCompany from the response — this echoes back the filter slugs
  const querySlugs = post.query?.authorsCompany;
  if (querySlugs && querySlugs.length === 1) {
    const match = slugToInstaller.get(querySlugs[0].toLowerCase());
    if (match) return match;
  }

  // For multi-slug queries, try matching each query slug
  if (querySlugs) {
    for (const slug of querySlugs) {
      const match = slugToInstaller.get(slug.toLowerCase());
      if (match) return match;
    }
  }

  // Fallback: try matching author headline against company names
  const headline = (post.author?.info || "").toLowerCase();
  if (headline) {
    let bestMatch: { installerId: number; length: number } | null = null;
    for (const company of batch) {
      const name = company.companyName.toLowerCase();
      if (headline.includes(name) && (!bestMatch || name.length > bestMatch.length)) {
        bestMatch = { installerId: company.installerId, length: name.length };
      }
    }
    if (bestMatch) return bestMatch.installerId;
  }

  // Last resort: if all results are from the same batch, assign to first
  // (the authorsCompanies filter guarantees they work at one of these companies)
  return batch[0].installerId;
}

// ── Inngest entry point ──────────────────────────────────────────

export async function enrichLinkedInSignalsBatch(
  jobId: number,
  options?: { keywords?: string[]; postedLimit?: string; companyBatchSize?: number; maxCompanies?: number }
): Promise<void> {
  try {
    // Step 1: Sync any new LinkedIn URLs from marketingSignals
    const { synced } = await syncLinkedInUrls();
    console.log(`[linkedin-signals] Synced ${synced} new LinkedIn URLs`);

    // Step 2: Search for posts with user-configured options
    const result = await searchLinkedInPosts({
      keywords: options?.keywords,
      postedLimit: options?.postedLimit,
      companyBatchSize: options?.companyBatchSize,
      maxCompanies: options?.maxCompanies,
    });
    console.log(
      `[linkedin-signals] Done: ${result.processed} posts checked, ${result.newSignals} new signals, ${result.errors} errors`
    );

    await db
      .update(enrichmentJobs)
      .set({
        processedItems: result.processed,
        errorCount: result.errors,
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      .where(eq(enrichmentJobs.id, jobId));
  } catch (err) {
    await db
      .update(enrichmentJobs)
      .set({
        status: "failed",
        errorLog: JSON.stringify([String(err)]),
        completedAt: new Date().toISOString(),
      })
      .where(eq(enrichmentJobs.id, jobId));
    throw err;
  }
}
