import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { socialSignals, installers } from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

export const maxDuration = 60;

export async function POST() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not set" }, { status: 500 });
  }

  // Get unscored signals with post text
  const unscored = await db
    .select({
      id: socialSignals.id,
      installerId: socialSignals.installerId,
      postText: socialSignals.postText,
      authorName: socialSignals.authorName,
    })
    .from(socialSignals)
    .where(sql`${socialSignals.relevanceScore} IS NULL AND ${socialSignals.postText} IS NOT NULL AND LENGTH(${socialSignals.postText}) > 20`)
    .limit(50);

  if (unscored.length === 0) {
    return NextResponse.json({ scored: 0, message: "All posts already scored" });
  }

  // Get installer names for context
  const installerIds = [...new Set(unscored.map((s) => s.installerId))];
  const installerNames = new Map<number, string>();
  for (const iId of installerIds) {
    const [inst] = await db.select({ name: installers.companyName }).from(installers).where(eq(installers.id, iId)).limit(1);
    if (inst) installerNames.set(iId, inst.name);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const postsForAi = unscored.map((s, i) => {
    const company = installerNames.get(s.installerId) || "unknown company";
    return `[${i}] (${company}) ${s.authorName}: ${s.postText!.slice(0, 500)}`;
  }).join("\n\n");

  try {
    const result = await model.generateContent(`You are analyzing LinkedIn posts from employees of UK solar/renewable energy installer companies.

Score each post for its relevance as a SALES SIGNAL — meaning it indicates the company is active, growing, investing, hiring, or could be a good prospect for selling them marketing/software services.

For each post, return:
- score: 0-100 (0 = completely irrelevant personal post, 100 = strong buying signal like hiring, expanding, investing in marketing)
- reason: 1 sentence explaining why this score

Return JSON array: [{"index": 0, "score": 75, "reason": "Company is hiring, indicates growth"}]

Posts:
${postsForAi}`);

    const text = result.response.text();
    const match = text.match(/\[[\s\S]*\]/);
    let scored = 0;

    if (match) {
      const scores = JSON.parse(match[0]) as { index: number; score: number; reason: string }[];
      for (const s of scores) {
        const signal = unscored[s.index];
        if (signal) {
          await db
            .update(socialSignals)
            .set({ relevanceScore: s.score, relevanceReason: s.reason })
            .where(eq(socialSignals.id, signal.id));
          scored++;
        }
      }
    }

    return NextResponse.json({ scored, total: unscored.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gemini scoring failed" },
      { status: 500 }
    );
  }
}
