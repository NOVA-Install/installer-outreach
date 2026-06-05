import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import {
  competitors,
  competitorEmployees,
  competitorPosts,
  competitorPostEngagement,
  installers,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

const COMPANY_POSTS_ACTOR = "harvestapi/linkedin-company-posts";
const PROFILE_POSTS_ACTOR = "harvestapi/linkedin-profile-posts";
const POST_REACTIONS_ACTOR = "harvestapi/linkedin-post-reactions";
const POST_COMMENTS_ACTOR = "harvestapi/linkedin-post-comments";

interface StepResult {
  posts: number;
  engagements: number;
  matchedInstallers: number;
  errors: number;
}

/**
 * Step 1: Scrape company page posts + employee profile posts for a single competitor.
 * Returns stored post IDs for the next step.
 */
export async function scrapeCompetitorPosts(competitorId: number): Promise<{
  storedPosts: { dbId: number; postUrl: string; postId: string | null }[];
  totalPosts: number;
  error?: string;
}> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  const [competitor] = await db
    .select()
    .from(competitors)
    .where(eq(competitors.id, competitorId))
    .limit(1);

  if (!competitor?.linkedinUrl) {
    return { storedPosts: [], totalPosts: 0, error: "No LinkedIn URL" };
  }

  const client = new ApifyClient({ token });
  const now = new Date().toISOString();
  const storedPosts: { dbId: number; postUrl: string; postId: string | null }[] = [];

  // Scrape company page posts (last 30 days)
  const companyRun = await client.actor(COMPANY_POSTS_ACTOR).start({
    companies: [competitor.linkedinUrl],
    maxPosts: 100,
    postedLimit: "month",
  });
  await client.run(companyRun.id).waitForFinish({ waitSecs: 120 });
  const companyItems = (await client.dataset(companyRun.defaultDatasetId).listItems())
    .items as Record<string, unknown>[];

  // Scrape employee profile posts
  const employees = await db
    .select()
    .from(competitorEmployees)
    .where(eq(competitorEmployees.competitorId, competitorId));

  const employeeUrls = employees
    .filter((e) => e.profileUrl)
    .map((e) => e.profileUrl!);

  let employeeItems: Record<string, unknown>[] = [];
  if (employeeUrls.length > 0) {
    const profileRun = await client.actor(PROFILE_POSTS_ACTOR).start({
      targetUrls: employeeUrls,
      maxPosts: 50,
      postedLimit: "month",
    });
    await client.run(profileRun.id).waitForFinish({ waitSecs: 180 });
    employeeItems = (await client.dataset(profileRun.defaultDatasetId).listItems())
      .items as Record<string, unknown>[];
  }

  // Store all posts
  const allPosts: Record<string, unknown>[] = [...companyItems, ...employeeItems];

  for (const post of allPosts) {
    const postId = (post.id as string) || (post.urn as string) || null;
    const postUrl = (post.linkedinUrl as string) || (post.url as string) || "";
    const author = post.author as Record<string, unknown> | undefined;
    const engagement = post.engagement as Record<string, unknown> | undefined;
    const postedAt = post.postedAt as Record<string, unknown> | undefined;
    const postText = ((post.content as string) || "").slice(0, 5000);
    const authorName = (author?.name as string) || competitor.name;

    const authorProfileUrl = (author?.linkedinUrl as string) || "";
    const matchedEmployee = employees.find(
      (e) => e.profileUrl && authorProfileUrl.includes(e.profileUrl.replace(/\/$/, ""))
    );

    try {
      const [inserted] = await db
        .insert(competitorPosts)
        .values({
          competitorId,
          employeeId: matchedEmployee?.id ?? null,
          postUrl,
          postId,
          authorName,
          postText,
          postedAt: (postedAt?.date as string) || null,
          likes: (engagement?.likes as number) ?? null,
          comments: (engagement?.comments as number) ?? null,
          shares: (engagement?.shares as number) ?? null,
          scrapedAt: now,
        })
        .onConflictDoNothing({ target: competitorPosts.postId })
        .returning({ id: competitorPosts.id });

      if (inserted && postUrl) {
        storedPosts.push({ dbId: inserted.id, postUrl, postId });
      }
    } catch {
      // skip duplicates
    }
  }

  return { storedPosts, totalPosts: storedPosts.length };
}

/**
 * Step 2: Scrape reactions for a batch of posts.
 */
export async function scrapePostReactions(
  competitorId: number,
  posts: { dbId: number; postUrl: string; postId: string | null }[]
): Promise<StepResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  if (posts.length === 0) return { posts: 0, engagements: 0, matchedInstallers: 0, errors: 0 };

  const client = new ApifyClient({ token });
  const now = new Date().toISOString();
  const postUrls = posts.map((p) => p.postUrl).filter(Boolean);
  let engagements = 0;
  let matched = 0;
  let errors = 0;

  try {
    const run = await client.actor(POST_REACTIONS_ACTOR).start({
      postUrls,
      maxReactions: 100,
    });
    await client.run(run.id).waitForFinish({ waitSecs: 120 });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    for (const item of items as Record<string, unknown>[]) {
      const name = (item.name as string) || (item.fullName as string) || "";
      if (!name) continue;

      const headline = (item.headline as string) || null;
      const profileUrl = (item.linkedinUrl as string) || (item.profileUrl as string) || null;
      const company = extractCompany(headline);
      const postUrl = (item.postUrl as string) || (item.sourceUrl as string) || "";

      const matchedPost = matchPostToStored(postUrl, posts);
      if (!matchedPost) continue;

      const installerId = company ? await findInstallerByCompany(company) : null;
      if (installerId) matched++;

      try {
        await db.insert(competitorPostEngagement).values({
          postId: matchedPost.dbId,
          competitorId,
          engagerName: name,
          engagerHeadline: headline,
          engagerProfileUrl: profileUrl,
          engagerCompany: company,
          installerId,
          engagementType: "like",
          scrapedAt: now,
        });
        engagements++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    console.error("[competitor-reactions] Error:", err);
    errors++;
  }

  return { posts: posts.length, engagements, matchedInstallers: matched, errors };
}

/**
 * Step 3: Scrape comments for a batch of posts.
 */
export async function scrapePostComments(
  competitorId: number,
  posts: { dbId: number; postUrl: string; postId: string | null }[]
): Promise<StepResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  if (posts.length === 0) return { posts: 0, engagements: 0, matchedInstallers: 0, errors: 0 };

  const client = new ApifyClient({ token });
  const now = new Date().toISOString();
  const postUrls = posts.map((p) => p.postUrl).filter(Boolean);
  let engagements = 0;
  let matched = 0;
  let errors = 0;

  try {
    const run = await client.actor(POST_COMMENTS_ACTOR).start({
      postUrls,
      maxComments: 100,
    });
    await client.run(run.id).waitForFinish({ waitSecs: 120 });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    for (const item of items as Record<string, unknown>[]) {
      const author = item.author as Record<string, unknown> | undefined;
      const name = (author?.name as string) || (item.name as string) || "";
      if (!name) continue;

      const headline = (author?.headline as string) || (item.headline as string) || null;
      const profileUrl = (author?.linkedinUrl as string) || (item.profileUrl as string) || null;
      const company = extractCompany(headline);
      const commentText = (item.text as string) || (item.comment as string) || null;
      const postUrl = (item.postUrl as string) || (item.sourceUrl as string) || "";

      const matchedPost = matchPostToStored(postUrl, posts);
      if (!matchedPost) continue;

      const installerId = company ? await findInstallerByCompany(company) : null;
      if (installerId) matched++;

      try {
        await db.insert(competitorPostEngagement).values({
          postId: matchedPost.dbId,
          competitorId,
          engagerName: name,
          engagerHeadline: headline,
          engagerProfileUrl: profileUrl,
          engagerCompany: company,
          installerId,
          engagementType: "comment",
          commentText,
          scrapedAt: now,
        });
        engagements++;
      } catch {
        errors++;
      }
    }
  } catch (err) {
    console.error("[competitor-comments] Error:", err);
    errors++;
  }

  return { posts: posts.length, engagements, matchedInstallers: matched, errors };
}

// ── Helpers ──

function extractActivityId(url: string): string | null {
  const match = url.match(/activity[:-](\d+)/);
  return match?.[1] ?? null;
}

function matchPostToStored(
  url: string,
  stored: { dbId: number; postUrl: string; postId: string | null }[]
): (typeof stored)[0] | undefined {
  if (!url) return undefined;
  const exact = stored.find((p) => p.postUrl === url);
  if (exact) return exact;
  const actId = extractActivityId(url);
  if (actId) {
    const byActivity = stored.find(
      (p) => p.postUrl.includes(actId) || p.postId?.includes(actId)
    );
    if (byActivity) return byActivity;
  }
  return stored.find((p) => url.includes(p.postUrl) || p.postUrl.includes(url));
}

function extractCompany(headline: string | null): string | null {
  if (!headline) return null;
  const atMatch = headline.match(/(?:at|@)\s+(.+?)(?:\s*[|·•—–-]|$)/i);
  if (atMatch) return atMatch[1].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·•—–-]\s*/);
  if (pipeMatch && pipeMatch[1].length < 60) return pipeMatch[1].trim();
  return null;
}

async function findInstallerByCompany(company: string): Promise<number | null> {
  if (company.length < 3) return null;
  const [match] = await db
    .select({ id: installers.id })
    .from(installers)
    .where(sql`LOWER(${installers.companyName}) LIKE ${"%" + company.toLowerCase() + "%"}`)
    .limit(1);
  return match?.id ?? null;
}
