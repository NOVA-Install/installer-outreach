import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { mysteryShopTargets, mysteryShopQuotes } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

let cachedModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function getModel() {
  if (cachedModel) return cachedModel;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY must be set");
  const genAI = new GoogleGenerativeAI(apiKey);
  cachedModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  return cachedModel;
}

function extractJsonArray<T>(text: string): T[] {
  // Try to extract a JSON array first
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T[];
    } catch { /* fall through */ }
  }
  // Try single object and wrap in array
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return [JSON.parse(objMatch[0]) as T];
    } catch { /* fall through */ }
  }
  throw new Error("No JSON found in AI response");
}

export interface ParsedQuoteOption {
  optionLabel: string | null;
  totalPrice: number | null;
  summary: string | null;
  details: {
    panels?: {
      count?: number;
      brand?: string;
      model?: string;
      wattageW?: number;
      priceEach?: number;
      totalPrice?: number;
    };
    battery?: {
      brand?: string;
      model?: string;
      capacityKwh?: number;
      price?: number;
    };
    inverter?: {
      brand?: string;
      model?: string;
      price?: number;
    };
    installation?: {
      cost?: number;
      scaffolding?: number;
    };
    vat?: {
      amount?: number;
      rate?: number;
      note?: string;
    };
    extras?: Array<{ name: string; price: number }>;
    warranty?: {
      panels?: number;
      inverter?: number;
      workmanship?: number;
    };
    estimatedAnnualGeneration?: number;
    estimatedAnnualSaving?: number;
    paybackYears?: number;
    [key: string]: unknown;
  };
  confidence: number;
  responseType: "quote" | "phone_callback_pending" | "auto_response" | "irrelevant" | "no_price_shown";
}

const PARSE_PROMPT = `You are extracting structured solar panel quote data from raw text scraped from a solar installer's website calculator or quote response.

Analyse the text and extract ALL quote options. If the page shows multiple options (e.g. "Standard" vs "Premium"), extract each as a separate item.

For each option, extract:
- optionLabel: Name of the option (e.g. "Standard", "Premium", "Option A"), or null if only one option
- totalPrice: Total price in GBP as a number (no currency symbol), or null if not shown
- summary: A one-line human-readable summary (e.g. "10x JA Solar 415W + GivEnergy 9.5kWh = £8,400")
- details: A structured breakdown with these keys where available:
  - panels: { count, brand, model, wattageW, priceEach, totalPrice }
  - battery: { brand, model, capacityKwh, price }
  - inverter: { brand, model, price }
  - installation: { cost, scaffolding }
  - vat: { amount, rate, note }
  - extras: [{ name, price }] for any additional items
  - warranty: { panels (years), inverter (years), workmanship (years) }
  - estimatedAnnualGeneration (kWh)
  - estimatedAnnualSaving (£)
  - paybackYears
- confidence: 0 to 1 — how confident you are in the extraction accuracy
- responseType: one of:
  - "quote" — a real price/quote was found
  - "no_price_shown" — calculator page loaded but no price displayed (maybe needs more input)
  - "phone_callback_pending" — response says they'll call back
  - "auto_response" — automated acknowledgment, no quote
  - "irrelevant" — not a quote at all

Return a JSON array of options. Use null for any fields you cannot determine.
If no meaningful quote data is found, return a single item with responseType "no_price_shown" and confidence 0.

RAW TEXT:
`;

/**
 * Parse a single target's raw response data into structured quotes.
 */
export async function parseQuoteResponse(
  targetId: number,
  rawData: string
): Promise<ParsedQuoteOption[]> {
  const model = getModel();

  // Truncate very long text to avoid token limits
  const truncated = rawData.length > 15000 ? rawData.slice(0, 15000) + "\n...[truncated]" : rawData;

  const result = await model.generateContent(PARSE_PROMPT + truncated);
  const text = result.response.text();
  return extractJsonArray<ParsedQuoteOption>(text);
}

/**
 * Process a batch of targets that need AI parsing.
 * Finds targets with aiParseStatus="pending", parses them, and saves quotes.
 */
export async function parseQuoteBatch(
  batchSize: number = 10
): Promise<{ processed: number; errors: number; remaining: number }> {
  const targets = await db
    .select()
    .from(mysteryShopTargets)
    .where(
      and(
        eq(mysteryShopTargets.status, "response_received"),
        eq(mysteryShopTargets.aiParseStatus, "pending")
      )
    )
    .limit(batchSize);

  if (targets.length === 0) {
    return { processed: 0, errors: 0, remaining: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const target of targets) {
    try {
      const rawData = target.rawResponseData;
      if (!rawData) {
        throw new Error("No raw response data");
      }

      // Extract the page text from the raw data
      let textToParse: string;
      try {
        const parsed = JSON.parse(rawData);
        textToParse = parsed.pageText || JSON.stringify(parsed);
      } catch {
        textToParse = rawData;
      }

      const options = await parseQuoteResponse(target.id, textToParse);

      // Save each option as a quote row
      for (const option of options) {
        if (option.responseType === "irrelevant") continue;

        await db.insert(mysteryShopQuotes).values({
          targetId: target.id,
          optionLabel: option.optionLabel,
          totalPrice: option.totalPrice,
          summary: option.summary,
          details: JSON.stringify(option.details),
          rawAiOutput: JSON.stringify(option),
          confidence: option.confidence,
        });
      }

      // Determine final target status based on response type
      const hasQuote = options.some((o) => o.responseType === "quote" && o.totalPrice != null);
      const newStatus = hasQuote ? "parsed" : "response_received";

      await db
        .update(mysteryShopTargets)
        .set({
          aiParseStatus: "parsed",
          status: newStatus,
        })
        .where(eq(mysteryShopTargets.id, target.id));

      processed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const existingLog = target.errorLog ? JSON.parse(target.errorLog) : [];
      existingLog.push(`AI parse error: ${errorMsg}`);

      await db
        .update(mysteryShopTargets)
        .set({
          aiParseStatus: "failed",
          errorLog: JSON.stringify(existingLog),
        })
        .where(eq(mysteryShopTargets.id, target.id));

      errors++;
    }
  }

  // Count remaining
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(mysteryShopTargets)
    .where(
      and(
        eq(mysteryShopTargets.status, "response_received"),
        eq(mysteryShopTargets.aiParseStatus, "pending")
      )
    );

  return { processed, errors, remaining: Number(count) };
}
