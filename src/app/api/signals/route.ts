import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialSignals, installers, linkedinContacts } from "@/lib/db/schema";
import { eq, desc, sql, and, type SQL } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const pageSize = Math.min(100, parseInt(params.get("pageSize") || "50", 10));
  const search = params.get("search") || "";
  const signalType = params.get("signalType") || "";
  const status = params.get("status") || ""; // "new" | "dismissed" | "actioned" | "" (all)
  const minRelevance = parseInt(params.get("minRelevance") || "0", 10);
  const sortBy = params.get("sortBy") || "postedAt";

  const conditions: SQL[] = [];

  if (search) {
    conditions.push(
      sql`(${installers.companyName} ILIKE ${"%" + search + "%"} OR ${socialSignals.authorName} ILIKE ${"%" + search + "%"} OR ${socialSignals.postText} ILIKE ${"%" + search + "%"})`
    );
  }

  if (signalType) {
    conditions.push(eq(socialSignals.signalType, signalType));
  }

  if (status) {
    conditions.push(sql`COALESCE(${socialSignals.status}, 'new') = ${status}`);
  }

  if (minRelevance > 0) {
    conditions.push(sql`${socialSignals.relevanceScore} >= ${minRelevance}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol =
    sortBy === "fetchedAt" ? socialSignals.fetchedAt
    : sortBy === "relevance" ? socialSignals.relevanceScore
    : socialSignals.postedAt;

  const orderDir = sortBy === "relevance" ? desc(orderCol) : desc(orderCol);

  const results = await db
    .select({
      id: socialSignals.id,
      installerId: socialSignals.installerId,
      contactId: socialSignals.contactId,
      postId: socialSignals.postId,
      postUrl: socialSignals.postUrl,
      postText: socialSignals.postText,
      authorName: socialSignals.authorName,
      authorHeadline: socialSignals.authorHeadline,
      authorProfileUrl: socialSignals.authorProfileUrl,
      authorProfileId: socialSignals.authorProfileId,
      postedAt: socialSignals.postedAt,
      likes: socialSignals.likes,
      comments: socialSignals.comments,
      shares: socialSignals.shares,
      matchedKeyword: socialSignals.matchedKeyword,
      relevanceScore: socialSignals.relevanceScore,
      relevanceReason: socialSignals.relevanceReason,
      status: socialSignals.status,
      signalType: socialSignals.signalType,
      fetchedAt: socialSignals.fetchedAt,
      companyName: installers.companyName,
      companyWebsite: installers.website,
      pipelineStage: installers.pipelineStage,
      contactAvatarUrl: linkedinContacts.avatarUrl,
      contactName: linkedinContacts.name,
      _total: sql<number>`COUNT(*) OVER()`.as("_total"),
    })
    .from(socialSignals)
    .innerJoin(installers, eq(socialSignals.installerId, installers.id))
    .leftJoin(linkedinContacts, eq(socialSignals.contactId, linkedinContacts.id))
    .where(whereClause)
    .orderBy(orderDir)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const total = results.length > 0 ? results[0]._total : 0;
  const data = results.map(({ _total, ...row }) => row);

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
