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
  appSettings,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const maxDuration = 60;

const DEFAULT_OUTREACH_PROMPT = `You are filling in a message template. The message is FIXED — you are only customising the parts marked with [FILL].

TEMPLATE:
---
Hi {{contactName}}, saw your post about [FILL: write a natural, short summary of what their LinkedIn post is about — keep it under 15 words, lowercase, no quotes].{{additionalContext}} Thought it would be worth reaching out.

We run a nationwide solar campaign and we're bringing on a small number of high performing installers in each area before we close it off. We've analysed every installer in your area across reviews, online presence, pricing and marketing.

Happy to share where {{companyName}} ranks and how our campaign works if you're interested.
---

YOUR ONLY JOB:
1. Replace [FILL] with a short, natural description of their LinkedIn post topic
2. If there is additional context, weave it into the first paragraph naturally (e.g. "We worked together on ECO4, so thought it would be worth reaching out")
3. If there is no additional context, just use "Thought it would be worth reaching out"
4. Output the final message with NO other changes to the template text
5. Do NOT add paragraphs, sentences, or information that isn't in the template
6. Do NOT change the wording of paragraphs 2 or 3
7. Do NOT add a sign-off, greeting, or subject line (unless email format is requested)`;

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

  // Fetch installer + enrichment data + custom prompt in parallel
  const [
    [installer],
    [gReview],
    [tpReview],
    [scores],
    [signal],
    [marketing],
    [{ totalSignals }],
    [promptSetting],
  ] = await Promise.all([
    db.select().from(installers).where(eq(installers.id, installerId)).limit(1),
    db.select().from(googleReviews).where(eq(googleReviews.installerId, installerId)).limit(1),
    db.select().from(trustpilotReviews).where(eq(trustpilotReviews.installerId, installerId)).limit(1),
    db.select().from(installerScores).where(eq(installerScores.installerId, installerId)).limit(1),
    db.select().from(socialSignals).where(eq(socialSignals.id, signalId)).limit(1),
    db.select().from(marketingSignals).where(eq(marketingSignals.installerId, installerId)).limit(1),
    db.select({ totalSignals: sql<number>`count(*)` }).from(socialSignals).where(eq(socialSignals.installerId, installerId)),
    db.select().from(appSettings).where(eq(appSettings.key, "outreach_prompt")).limit(1),
  ]);

  if (!installer || !signal) {
    return NextResponse.json({ error: "Installer or signal not found" }, { status: 404 });
  }

  // Load custom prompt or use default
  let customPrompt = DEFAULT_OUTREACH_PROMPT;
  if (promptSetting) {
    try {
      customPrompt = JSON.parse(promptSetting.value);
    } catch {
      customPrompt = promptSetting.value;
    }
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

  // Substitute template variables into the custom prompt
  const renderedPrompt = customPrompt
    .replace(/\{\{companyName\}\}/g, installer.companyName)
    .replace(/\{\{contactName\}\}/g, signal.authorName || "Unknown")
    .replace(/\{\{contactRole\}\}/g, signal.authorHeadline || "Unknown")
    .replace(/\{\{location\}\}/g, installer.address || installer.postcode || "UK")
    .replace(/\{\{linkedinPost\}\}/g, (signal.postText || "").slice(0, 800))
    .replace(/\{\{dataPoints\}\}/g, messageType === "email" ? dataPointsSummary : "")
    .replace(/\{\{additionalContext\}\}/g, additionalContext || "");

  const formatInstructions = messageType === "linkedin"
    ? `Output the completed template exactly as shown. No subject line. No sign-off.`
    : `Add "Subject: ..." at the very top (a short, casual subject line). Then output the completed template. Add "Chris" as a sign-off at the end. Do NOT add any extra content.`;

  const prompt = `${renderedPrompt}

THE PERSON YOU'RE MESSAGING:
- Company: ${installer.companyName}
- Name: ${signal.authorName || "Unknown"}
- Role: ${signal.authorHeadline || "Unknown"}
- Location: ${installer.address || installer.postcode || "UK"}
${messageType === "email" ? dataPointsSummary : ""}

THEIR RECENT LINKEDIN POST (reference something specific from this):
"${(signal.postText || "").slice(0, 800)}"

${additionalContext ? `EXTRA CONTEXT:\n${additionalContext}\n` : ""}
${formatInstructions}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    const result = await model.generateContent(prompt);
    let message = result.response.text().trim();

    // For email, also generate a short LinkedIn DM companion
    let linkedinCompanion: string | null = null;
    if (messageType === "email") {
      // Extract the [FILL] topic from the generated email to reuse in the DM
      const topicMatch = message.match(/saw your (?:post|email|message) (?:about|on) (.+?)[\.\,\n]/i);
      const topic = topicMatch ? topicMatch[1].trim() : "your recent post";
      const firstName = (signal.authorName || "").split(" ")[0] || "there";
      linkedinCompanion = `Hi ${firstName}, saw your post about ${topic}. I think it's worth a chat. Just sent you an email with some more details. Chris`;
    }

    // Persist the generated message(s) on the signal
    await db
      .update(socialSignals)
      .set(messageType === "linkedin"
        ? { generatedLinkedinMsg: message }
        : { generatedEmailMsg: message, generatedLinkedinMsg: linkedinCompanion }
      )
      .where(eq(socialSignals.id, signalId));

    return NextResponse.json({ message, messageType, linkedinCompanion });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Message generation failed" },
      { status: 500 }
    );
  }
}
