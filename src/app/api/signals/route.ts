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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol =
    sortBy === "fetchedAt" ? socialSignals.fetchedAt : socialSignals.postedAt;

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
      signalType: socialSignals.signalType,
      fetchedAt: socialSignals.fetchedAt,
      companyName: installers.companyName,
      companyWebsite: installers.website,
      contactAvatarUrl: linkedinContacts.avatarUrl,
      contactName: linkedinContacts.name,
      _total: sql<number>`COUNT(*) OVER()`.as("_total"),
    })
    .from(socialSignals)
    .innerJoin(installers, eq(socialSignals.installerId, installers.id))
    .leftJoin(linkedinContacts, eq(socialSignals.contactId, linkedinContacts.id))
    .where(whereClause)
    .orderBy(desc(orderCol))
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
