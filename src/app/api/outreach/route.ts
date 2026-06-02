import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { outreachMessages, installers, socialSignals } from "@/lib/db/schema";
import { eq, desc, sql, and, type SQL } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") || "";
  const platform = params.get("platform") || "";
  const search = params.get("search") || "";

  const conditions: SQL[] = [];

  if (status) {
    conditions.push(eq(outreachMessages.status, status));
  }
  if (platform) {
    conditions.push(eq(outreachMessages.platform, platform));
  }
  if (search) {
    conditions.push(
      sql`(${outreachMessages.contactName} ILIKE ${"%" + search + "%"} OR ${installers.companyName} ILIKE ${"%" + search + "%"})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: outreachMessages.id,
      installerId: outreachMessages.installerId,
      signalId: outreachMessages.signalId,
      contactName: outreachMessages.contactName,
      contactLinkedinUrl: outreachMessages.contactLinkedinUrl,
      contactEmail: outreachMessages.contactEmail,
      contactPhone: outreachMessages.contactPhone,
      platform: outreachMessages.platform,
      message: outreachMessages.message,
      status: outreachMessages.status,
      notes: outreachMessages.notes,
      createdAt: outreachMessages.createdAt,
      updatedAt: outreachMessages.updatedAt,
      companyName: installers.companyName,
      companyWebsite: installers.website,
      postText: socialSignals.postText,
      postUrl: socialSignals.postUrl,
      postAuthorName: socialSignals.authorName,
      postPostedAt: socialSignals.postedAt,
    })
    .from(outreachMessages)
    .innerJoin(installers, eq(outreachMessages.installerId, installers.id))
    .leftJoin(socialSignals, eq(outreachMessages.signalId, socialSignals.id))
    .where(whereClause)
    .orderBy(desc(outreachMessages.updatedAt));

  return NextResponse.json({ data: results });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    installerId,
    signalId,
    contactName,
    contactLinkedinUrl,
    contactEmail,
    contactPhone,
    platform,
    message,
    notes,
  } = body;

  if (!installerId || !contactName || !platform || !message) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const [row] = await db
    .insert(outreachMessages)
    .values({
      installerId,
      signalId: signalId || null,
      contactName,
      contactLinkedinUrl: contactLinkedinUrl || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      platform,
      message,
      status: "draft",
      notes: notes || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(row);
}
