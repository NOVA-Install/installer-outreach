import { NextRequest, NextResponse } from "next/server";
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

export const maxDuration = 300; // 5 minutes — multiple Apify calls

const COMPANY_POSTS_ACTOR = "harvestapi/linkedin-company-posts";
const PROFILE_POSTS_ACTOR = "harvestapi/linkedin-profile-posts";
const POST_REACTIONS_ACTOR = "harvestapi/linkedin-post-reactions";
const POST_COMMENTS_ACTOR = "harvestapi/linkedin-post-comments";

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
    return NextResponse.json({ error: "No LinkedIn URL set" }, { status: 400 });
  }

  const client = new ApifyClient({ token });
  const now = new Date().toISOString();
  let totalPosts = 0;
  let totalEngagements = 0;
  let matchedInstallers = 0;

  try {
    // ── Step 1: Scrape company page posts ──
    const companyRun = await client.actor(COMPANY_POSTS_ACTOR).start({
      companies: [competitor.linkedinUrl],
      maxPosts: 20,
    });
    await client.run(companyRun.id).waitForFinish({ waitSecs: 60 });
    const companyPostItems = (await client.dataset(companyRun.defaultDatasetId).listItems()).items;

    // ── Step 2: Scrape employee profile posts ──
    const employees = await db
      .select()
      .from(competitorEmployees)
      .where(eq(competitorEmployees.competitorId, competitorId));

    const employeeUrls = employees
      .filter((e) => e.profileUrl)
      .map((e) => e.profileUrl!);

    let employeePostItems: Record<string, unknown>[] = [];
    if (employeeUrls.length > 0) {
      const profileRun = await client.actor(PROFILE_POSTS_ACTOR).start({
        targetUrls: employeeUrls,
        maxPosts: 5,
        postedLimit: "month",
      });
      await client.run(profileRun.id).waitForFinish({ waitSecs: 120 });
      employeePostItems = (await client.dataset(profileRun.defaultDatasetId).listItems())
        .items as Record<string, unknown>[];
    }

    // ── Step 3: Store all posts ──
    const allPosts: Record<string, unknown>[] = [
      ...(companyPostItems as Record<string, unknown>[]),
      ...employeePostItems,
    ];

    const storedPostIds: { dbId: number; postUrl: string }[] = [];

    for (const post of allPosts) {
      const postId = (post.id as string) || (post.urn as string) || null;
      const postUrl = (post.linkedinUrl as string) || (post.url as string) || "";
      const author = post.author as Record<string, unknown> | undefined;
      const engagement = post.engagement as Record<string, unknown> | undefined;
      const postedAt = post.postedAt as Record<string, unknown> | undefined;
      const postText = ((post.content as string) || "").slice(0, 5000);
      const authorName = (author?.name as string) || competitor.name;

      // Match to employee
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
          storedPostIds.push({ dbId: inserted.id, postUrl });
          totalPosts++;
        }
      } catch {
        // Skip duplicate/malformed posts
      }
    }

    // ── Step 4: Scrape reactions + comments for posts with engagement ──
    // Only scrape posts that have likes or comments > 0
    const postsToScrape = storedPostIds.slice(0, 30); // Cap to avoid excessive Apify costs

    if (postsToScrape.length > 0) {
      const postUrls = postsToScrape.map((p) => p.postUrl).filter(Boolean);

      // Reactions
      const reactionsRun = await client.actor(POST_REACTIONS_ACTOR).start({
        postUrls,
        maxReactions: 50,
      });
      await client.run(reactionsRun.id).waitForFinish({ waitSecs: 60 });
      const reactionItems = (await client.dataset(reactionsRun.defaultDatasetId).listItems())
        .items as Record<string, unknown>[];

      for (const reaction of reactionItems) {
        const reactorName = (reaction.name as string) || (reaction.fullName as string) || "";
        if (!reactorName) continue;
        const reactorHeadline = (reaction.headline as string) || null;
        const reactorProfileUrl = (reaction.linkedinUrl as string) || (reaction.profileUrl as string) || null;
        const reactorCompany = extractCompany(reactorHeadline);
        const postUrl = (reaction.postUrl as string) || (reaction.sourceUrl as string) || "";

        const matchedPost = postsToScrape.find((p) => postUrl.includes(p.postUrl) || p.postUrl.includes(postUrl));
        if (!matchedPost) continue;

        const matchedInstaller = reactorCompany
          ? await findInstallerByCompany(reactorCompany)
          : null;
        if (matchedInstaller) matchedInstallers++;

        await db.insert(competitorPostEngagement).values({
          postId: matchedPost.dbId,
          competitorId,
          engagerName: reactorName,
          engagerHeadline: reactorHeadline,
          engagerProfileUrl: reactorProfileUrl,
          engagerCompany: reactorCompany,
          installerId: matchedInstaller,
          engagementType: "like",
          scrapedAt: now,
        });
        totalEngagements++;
      }

      // Comments
      const commentsRun = await client.actor(POST_COMMENTS_ACTOR).start({
        postUrls,
        maxComments: 50,
      });
      await client.run(commentsRun.id).waitForFinish({ waitSecs: 60 });
      const commentItems = (await client.dataset(commentsRun.defaultDatasetId).listItems())
        .items as Record<string, unknown>[];

      for (const comment of commentItems) {
        const author = comment.author as Record<string, unknown> | undefined;
        const commenterName = (author?.name as string) || (comment.name as string) || "";
        if (!commenterName) continue;
        const commenterHeadline = (author?.headline as string) || (comment.headline as string) || null;
        const commenterProfileUrl = (author?.linkedinUrl as string) || (comment.profileUrl as string) || null;
        const commenterCompany = extractCompany(commenterHeadline);
        const commentText = (comment.text as string) || (comment.comment as string) || null;
        const postUrl = (comment.postUrl as string) || (comment.sourceUrl as string) || "";

        const matchedPost = postsToScrape.find((p) => postUrl.includes(p.postUrl) || p.postUrl.includes(postUrl));
        if (!matchedPost) continue;

        const matchedInstaller = commenterCompany
          ? await findInstallerByCompany(commenterCompany)
          : null;
        if (matchedInstaller) matchedInstallers++;

        await db.insert(competitorPostEngagement).values({
          postId: matchedPost.dbId,
          competitorId,
          engagerName: commenterName,
          engagerHeadline: commenterHeadline,
          engagerProfileUrl: commenterProfileUrl,
          engagerCompany: commenterCompany,
          installerId: matchedInstaller,
          engagementType: "comment",
          commentText,
          scrapedAt: now,
        });
        totalEngagements++;
      }
    }

    return NextResponse.json({
      posts: totalPosts,
      engagements: totalEngagements,
      matchedInstallers,
      competitor: competitor.name,
    });
  } catch (err) {
    console.error("[competitor-scrape-posts] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** Extract company name from a LinkedIn headline like "Solar Engineer at Green Energy Co" */
function extractCompany(headline: string | null): string | null {
  if (!headline) return null;
  // Common patterns: "Role at Company", "Role @ Company", "Company | Role"
  const atMatch = headline.match(/(?:at|@)\s+(.+?)(?:\s*[|·•—–-]|$)/i);
  if (atMatch) return atMatch[1].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·•—–-]\s*/);
  if (pipeMatch && pipeMatch[1].length < 60) return pipeMatch[1].trim();
  return null;
}

/** Try to find an installer in our DB by fuzzy company name match */
async function findInstallerByCompany(company: string): Promise<number | null> {
  if (company.length < 3) return null;
  const [match] = await db
    .select({ id: installers.id })
    .from(installers)
    .where(sql`LOWER(${installers.companyName}) LIKE ${"%" + company.toLowerCase() + "%"}`)
    .limit(1);
  return match?.id ?? null;
}
