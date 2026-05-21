import { GoogleGenerativeAI } from "@google/generative-ai";

function getModel() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY must be set for AI matching");
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response");
  return JSON.parse(match[0]) as T;
}

// ─── Types ───

interface InstallerInfo {
  companyName: string;
  website: string | null;
  postcode: string | null;
  county: string | null;
}

export interface MatchResult {
  matched: boolean;
  matchIndex: number | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

// ─── 1. Trustpilot matching ───

interface TrustpilotCandidate {
  index: number;
  name: string;
  domain: string | null;
  rating: number | null;
  reviewCount: number | null;
  location: string | null;
  categories: string | null;
}

export async function aiMatchTrustpilot(
  installer: InstallerInfo,
  candidates: TrustpilotCandidate[]
): Promise<MatchResult> {
  if (candidates.length === 0) {
    return { matched: false, matchIndex: null, confidence: "high", reasoning: "No candidates" };
  }

  const model = getModel();
  const candidateList = candidates
    .map((c) => `[${c.index}] Name: "${c.name}" | Domain: ${c.domain || "none"} | Rating: ${c.rating ?? "n/a"} (${c.reviewCount ?? 0} reviews) | Location: ${c.location || "unknown"} | Categories: ${c.categories || "n/a"}`)
    .join("\n");

  const result = await model.generateContent(`You are matching a UK solar installer to its Trustpilot profile.

INSTALLER:
- Name: "${installer.companyName}"
- Website: ${installer.website || "unknown"}
- Postcode: ${installer.postcode || "unknown"}
- County: ${installer.county || "unknown"}

TRUSTPILOT CANDIDATES:
${candidateList}

Rules:
- Only match if genuinely confident this is the same business
- Domain matching the installer's website is strong evidence
- Business must be related to solar/energy/electrical/home improvement
- Generic names need extra caution
- False positive is worse than a missed match

Respond ONLY with JSON:
{"matched": true/false, "matchIndex": <index or null>, "confidence": "high"/"medium"/"low", "reasoning": "<one sentence>"}`);

  try {
    const parsed = extractJson<MatchResult>(result.response.text());
    if (typeof parsed.matched !== "boolean") throw new Error();
    if (parsed.matched && (parsed.matchIndex == null || parsed.matchIndex < 0 || parsed.matchIndex >= candidates.length)) throw new Error();
    return parsed;
  } catch {
    return { matched: false, matchIndex: null, confidence: "low", reasoning: `Parse failed: ${result.response.text().slice(0, 80)}` };
  }
}

// ─── 2. Google Reviews matching ───

interface GoogleReviewCandidate {
  index: number;
  title: string;
  address: string | null;
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
}

export async function aiMatchGoogleReview(
  installer: InstallerInfo,
  candidates: GoogleReviewCandidate[]
): Promise<MatchResult> {
  if (candidates.length === 0) {
    return { matched: false, matchIndex: null, confidence: "high", reasoning: "No candidates" };
  }

  const model = getModel();
  const candidateList = candidates
    .map((c) => `[${c.index}] Title: "${c.title}" | Address: ${c.address || "unknown"} | Rating: ${c.rating ?? "n/a"} (${c.reviewCount ?? 0} reviews) | Category: ${c.category || "n/a"}`)
    .join("\n");

  const result = await model.generateContent(`You are matching a UK solar installer to its Google Business profile.

INSTALLER:
- Name: "${installer.companyName}"
- Website: ${installer.website || "unknown"}
- Postcode: ${installer.postcode || "unknown"}
- County: ${installer.county || "unknown"}

GOOGLE BUSINESS CANDIDATES:
${candidateList}

Rules:
- If the business name is an exact or very close match (e.g. "Ltd" vs "Limited", minor abbreviations), ACCEPT IT even if the address is unknown. Many service-area businesses hide their address on Google.
- An unknown address is NOT a reason to reject an otherwise strong name match.
- The search was already location-specific (included the postcode), so the result is likely in the right area.
- Only reject if the names clearly refer to different businesses (e.g. "ABC Solar" vs "ABC Restaurant").
- If the candidate is clearly in a completely unrelated industry (restaurant, shop, hotel), reject it.
- IGNORE the "category" field if it says "google_reviews" — that is a DataForSEO artefact, NOT an actual business category. It tells you nothing about the business type.
- Generic names like "Solar Solutions" or "Green Energy" need slightly more caution, but still accept if it's the only candidate with a relevant name.

Respond ONLY with JSON:
{"matched": true/false, "matchIndex": <index or null>, "confidence": "high"/"medium"/"low", "reasoning": "<one sentence>"}`);

  try {
    const parsed = extractJson<MatchResult>(result.response.text());
    if (typeof parsed.matched !== "boolean") throw new Error();
    if (parsed.matched && (parsed.matchIndex == null || parsed.matchIndex < 0 || parsed.matchIndex >= candidates.length)) throw new Error();
    return parsed;
  } catch {
    return { matched: false, matchIndex: null, confidence: "low", reasoning: `Parse failed: ${result.response.text().slice(0, 80)}` };
  }
}

// ─── 3. Companies House matching ───

interface CompaniesHouseCandidate {
  index: number;
  companyName: string;
  companyNumber: string;
  status: string;
  address: string | null;
  postalCode: string | null;
  sicCodes: string[] | null;
}

export async function aiMatchCompaniesHouse(
  installer: InstallerInfo,
  candidates: CompaniesHouseCandidate[]
): Promise<MatchResult> {
  if (candidates.length === 0) {
    return { matched: false, matchIndex: null, confidence: "high", reasoning: "No candidates" };
  }

  const model = getModel();
  const candidateList = candidates
    .map((c) => `[${c.index}] Name: "${c.companyName}" | Number: ${c.companyNumber} | Status: ${c.status} | Address: ${c.address || "unknown"} | Postcode: ${c.postalCode || "unknown"} | SIC: ${c.sicCodes?.join(", ") || "n/a"}`)
    .join("\n");

  const result = await model.generateContent(`You are matching a UK solar installer trading name to its Companies House legal entity.

INSTALLER (trading name):
- Name: "${installer.companyName}"
- Website: ${installer.website || "unknown"}
- Postcode: ${installer.postcode || "unknown"}
- County: ${installer.county || "unknown"}

COMPANIES HOUSE CANDIDATES:
${candidateList}

Rules:
- The legal name often differs from the trading name (e.g. "Sunny Solar" might be registered as "Sunny Solar Ltd" or "Sunny Solar Solutions Limited")
- Prefer active companies over dissolved ones
- Postcode/address proximity matters — the registered office should be in a plausible location for this installer
- SIC codes starting with 43 (construction/installation), 42 (civil engineering), or 35 (electricity/gas) are good signals. Codes for restaurants, retail, etc. are red flags.
- If there are multiple plausible matches, pick the one with the closest name AND location
- Be cautious with very common names — require strong address evidence
- False positive is worse than a missed match

Respond ONLY with JSON:
{"matched": true/false, "matchIndex": <index or null>, "confidence": "high"/"medium"/"low", "reasoning": "<one sentence>"}`);

  try {
    const parsed = extractJson<MatchResult>(result.response.text());
    if (typeof parsed.matched !== "boolean") throw new Error();
    if (parsed.matched && (parsed.matchIndex == null || parsed.matchIndex < 0 || parsed.matchIndex >= candidates.length)) throw new Error();
    return parsed;
  } catch {
    return { matched: false, matchIndex: null, confidence: "low", reasoning: `Parse failed: ${result.response.text().slice(0, 80)}` };
  }
}

// ─── 4. Duplicate detection ───

interface DuplicateCandidate {
  index: number;
  companyName: string;
  postcode: string | null;
  email: string | null;
  website: string | null;
}

export interface DuplicateResult {
  isDuplicate: boolean;
  matchIndex: number | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export async function aiCheckDuplicate(
  incoming: { companyName: string; postcode: string; email?: string; website?: string },
  candidates: DuplicateCandidate[]
): Promise<DuplicateResult> {
  if (candidates.length === 0) {
    return { isDuplicate: false, matchIndex: null, confidence: "high", reasoning: "No candidates" };
  }

  const model = getModel();
  const candidateList = candidates
    .map((c) => `[${c.index}] Name: "${c.companyName}" | Postcode: ${c.postcode || "unknown"} | Email: ${c.email || "none"} | Website: ${c.website || "none"}`)
    .join("\n");

  const result = await model.generateContent(`You are checking if a company being imported already exists in the database under a slightly different name.

IMPORTING:
- Name: "${incoming.companyName}"
- Postcode: ${incoming.postcode || "unknown"}
- Email: ${incoming.email || "unknown"}
- Website: ${incoming.website || "unknown"}

EXISTING DATABASE RECORDS:
${candidateList}

Rules:
- "Solar Solutions Ltd" and "Solar Solutions Limited" ARE the same company
- "J Smith Solar" and "J. Smith Solar Energy" at the same postcode are likely the same
- Same email or website is strong duplicate evidence regardless of name
- Same postcode with very similar name is likely a duplicate
- Different postcode with similar name could be different branches — be cautious
- Completely different names at the same postcode are NOT duplicates

Respond ONLY with JSON:
{"isDuplicate": true/false, "matchIndex": <index or null>, "confidence": "high"/"medium"/"low", "reasoning": "<one sentence>"}`);

  try {
    const parsed = extractJson<DuplicateResult>(result.response.text());
    if (typeof parsed.isDuplicate !== "boolean") throw new Error();
    return parsed;
  } catch {
    return { isDuplicate: false, matchIndex: null, confidence: "low", reasoning: `Parse failed: ${result.response.text().slice(0, 80)}` };
  }
}
