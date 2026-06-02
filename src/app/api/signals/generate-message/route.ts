import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  installerScores,
  socialSignals,
  marketingSignals,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not set" }, { status: 500 });
  }

  const body = await request.json();
  const { installerId, signalId, messageType, additionalContext } = body as {
    installerId: number;
    signalId: number;
    messageType: "linkedin" | "email";
    additionalContext?: string;
  };

  if (!installerId || !signalId || !messageType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Fetch installer + enrichment data in parallel
  const [
    [installer],
    [gReview],
    [tpReview],
    [scores],
    [signal],
    [marketing],
    [{ totalSignals }],
  ] = await Promise.all([
    db.select().from(installers).where(eq(installers.id, installerId)).limit(1),
    db.select().from(googleReviews).where(eq(googleReviews.installerId, installerId)).limit(1),
    db.select().from(trustpilotReviews).where(eq(trustpilotReviews.installerId, installerId)).limit(1),
    db.select().from(installerScores).where(eq(installerScores.installerId, installerId)).limit(1),
    db.select().from(socialSignals).where(eq(socialSignals.id, signalId)).limit(1),
    db.select().from(marketingSignals).where(eq(marketingSignals.installerId, installerId)).limit(1),
    db.select({ totalSignals: sql<number>`count(*)` }).from(socialSignals).where(eq(socialSignals.installerId, installerId)),
  ]);

  if (!installer || !signal) {
    return NextResponse.json({ error: "Installer or signal not found" }, { status: 404 });
  }

  // Build data points summary
  const dataPoints: string[] = [];
  if (gReview) {
    dataPoints.push(`${gReview.reviewCount} Google reviews (${gReview.rating}/5 rating)`);
    if (gReview.reviewsPerMonth) dataPoints.push(`~${gReview.reviewsPerMonth.toFixed(1)} new Google reviews/month`);
  }
  if (tpReview) {
    dataPoints.push(`${tpReview.reviewCount} Trustpilot reviews (${tpReview.rating}/5 rating)`);
  }
  if (scores) {
    dataPoints.push(`Overall business score: ${Math.round(scores.overallScore || 0)}/100`);
  }
  if (marketing) {
    const signals: string[] = [];
    if (marketing.hasGoogleAds) signals.push("Google Ads");
    if (marketing.hasMetaAds) signals.push("Meta Ads");
    if (marketing.hasCrmTool) signals.push(`CRM (${marketing.crmToolName})`);
    if (signals.length) dataPoints.push(`Active marketing: ${signals.join(", ")}`);
  }
  if (totalSignals > 0) {
    dataPoints.push(`${totalSignals} LinkedIn posts tracked`);
  }

  const dataPointsSummary = dataPoints.length > 0
    ? `Data points we have on ${installer.companyName}:\n${dataPoints.map(d => `- ${d}`).join("\n")}`
    : `We have limited data on ${installer.companyName} so far.`;

  const formatInstructions = messageType === "linkedin"
    ? `Write a SHORT LinkedIn direct message (max 280 characters ideally, never more than 500). It should feel like a natural, casual DM — not a sales email. No subject line. Use first name if available. Keep it conversational, warm, and brief. Don't use bullet points. Don't be overly formal. No "Dear" or "Kind regards". End with a soft call to action like asking if they'd be open to a quick chat.`
    : `Write a concise cold email with a subject line. Keep the body to 3-5 short paragraphs. Be professional but personable. Use first name if available. Include a clear but low-pressure call to action. End with a simple sign-off. Format as:\nSubject: ...\n\n[body]`;

  const prompt = `You are writing an outreach message from NOVA to a solar installer company.

ABOUT NOVA:
- NOVA helps solar installers increase their installs
- No retainer fees or long-term commitments — performance-based
- The team previously built Fuse Energy (a retail energy company) and now helps local solar installers compete with the largest national installers
- NOVA is partnering with a select number of installers in each area — this is exclusive, not mass outreach
- NOVA analyses hundreds of data points per installer including reviews, online presence, marketing activity, and social signals

TARGET INSTALLER:
- Company: ${installer.companyName}
- Location: ${installer.address || installer.postcode || "UK"}
- Contact person: ${signal.authorName || "Unknown"}
- Their role: ${signal.authorHeadline || "Unknown"}
${dataPointsSummary}

THEIR RECENT LINKEDIN POST (use this to personalise the opening — reference it naturally):
"${(signal.postText || "").slice(0, 800)}"

${additionalContext ? `ADDITIONAL CONTEXT FROM THE USER:\n${additionalContext}\n` : ""}
${formatInstructions}

Important:
- Reference their LinkedIn post naturally in the opening to show you've actually read it — don't be generic
- Weave in 1-2 specific data points about their business if available (e.g. reviews, rating) to show you've done your homework
- Keep the tone friendly and confident, not desperate or salesy
- Make it clear this is selective — NOVA doesn't work with everyone
- Do NOT use placeholder brackets like [Name] — use the actual data provided
- Do NOT make up data points — only reference what's provided above`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent(prompt);
    const message = result.response.text().trim();

    return NextResponse.json({ message, messageType });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Message generation failed" },
      { status: 500 }
    );
  }
}
