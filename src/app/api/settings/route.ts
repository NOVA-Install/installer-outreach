import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return NextResponse.json({ value: null });

  try {
    return NextResponse.json({ value: JSON.parse(row.value) });
  } catch {
    return NextResponse.json({ value: row.value });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, value } = body;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await db
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value), updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(value), updatedAt: new Date().toISOString() },
    });

  return NextResponse.json({ ok: true });
}
