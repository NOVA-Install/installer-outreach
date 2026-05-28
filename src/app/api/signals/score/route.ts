import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { socialSignals, installers, appSettings } from "@/lib/db/schema";
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

  // Load user keywords
  let userKeywords: string[] = [];
  const [kwSetting] = await db.select().from(appSettings).where(eq(appSettings.key, "linkedin_signal_keywords")).limit(1);
  if (kwSetting) {
    try { userKeywords = JSON.parse(kwSetting.value); } catch {}
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const postsForAi = unscored.map((s, i) => {
    const company = installerNames.get(s.installerId) || "unknown company";
    return `[${i}] (${company}) ${s.authorName}: ${s.postText!.slice(0, 500)}`;
  }).join("\n\n");

  const keywordContext = userKeywords.length > 0
    ? `\n\nThe user tracks these keywords: ${userKeywords.join(", ")}.`
    : "";

  try {
    const result = await model.generateContent(`You are scoring LinkedIn posts from employees of UK solar/renewable energy installer companies. The user sells marketing, lead generation, and software services to these companies.

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
