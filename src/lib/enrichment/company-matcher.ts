/**
 * Tiered company name matching for Companies House lookups.
 *
 * Tier 1 – Normalised exact match (no AI)
 * Tier 2 – Jaro-Winkler string similarity ± postcode (no AI)
 * Tier 3 – AI matching (only for genuinely ambiguous cases)
 *
 * Returns metadata about which tier matched so we can track accuracy.
 */

// ─── Public types ───

export interface CompanyCandidate {
  index: number;
  companyName: string;
  companyNumber: string;
  status: string;
  address: string | null;
  postalCode: string | null;
  sicCodes: string[] | null;
}

export interface TieredMatchResult {
  matched: boolean;
  matchIndex: number | null;
  confidence: "high" | "medium" | "low";
  tier: "exact" | "similarity" | "ai" | "none";
  reasoning: string;
  similarityScore?: number;
}

// ─── Name normalisation ───

/**
 * Normalise a company name for comparison:
 * - lowercase
 * - strip legal suffixes (ltd, limited, llp, plc, inc, uk, co)
 * - strip "t/a …" (trading-as suffixes)
 * - strip "&amp;" → "&" → ""
 * - strip all punctuation except alphanumeric and spaces
 * - collapse whitespace, trim
 */
export function normaliseName(raw: string): string {
  let name = raw.toLowerCase();

  // Strip "t/a …" or "trading as …" and everything after
  name = name.replace(/\s+t\/a\s+.*$/i, "");
  name = name.replace(/\s+trading\s+as\s+.*$/i, "");

  // Decode HTML entities
  name = name.replace(/&amp;/g, "&");

  // Strip legal suffixes (with optional preceding dot/comma)
  // Must handle "ltd.", "limited", "(uk) ltd", etc.
  name = name.replace(
    /[,.]?\s*\(?(ltd\.?|limited|llp|plc|inc\.?|l\.t\.d\.?|uk)\)?\.?/gi,
    " "
  );

  // Strip punctuation (keep alphanumeric and spaces)
  name = name.replace(/[^a-z0-9\s]/g, " ");

  // Collapse whitespace and trim
  name = name.replace(/\s+/g, " ").trim();

  return name;
}

// ─── Postcode utilities ───

/**
 * Extract the postcode district (outward code) from a UK postcode.
 * e.g. "SW1A 1AA" → "sw1a", "B1 2NJ" → "b1", "EC2A 4NE" → "ec2a"
 */
export function postcodeDistrict(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const parts = postcode.trim().split(/\s+/);
  if (parts.length === 0) return null;
  return parts[0].toLowerCase();
}

// ─── Jaro-Winkler similarity ───

/**
 * Jaro similarity between two strings. Returns value in [0, 1].
 */
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchDistance = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);

  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/**
 * Jaro-Winkler similarity. Gives a boost for matching prefixes (up to 4 chars).
 * Returns value in [0, 1].
 */
export function jaroWinkler(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);

  // Find common prefix (up to 4 characters)
  let prefix = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) {
      prefix++;
    } else {
      break;
    }
  }

  // Winkler scaling factor (standard is 0.1)
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ─── Tier 1: Normalised exact match ───

interface Tier1Result {
  matchIndex: number;
  reasoning: string;
}

function tier1ExactMatch(
  installerName: string,
  candidates: CompanyCandidate[]
): Tier1Result | null {
  const normInstaller = normaliseName(installerName);
  if (!normInstaller) return null;

  for (const c of candidates) {
    const normCandidate = normaliseName(c.companyName);
    if (!normCandidate) continue;

    // Direct equality
    if (normInstaller === normCandidate) {
      return {
        matchIndex: c.index,
        reasoning: `Exact normalised match: "${normInstaller}" === "${normCandidate}"`,
      };
    }

    // Containment: installer name contained in candidate or vice versa
    // But only if the shorter string is at least 4 characters (avoid trivially short matches)
    const shorter = normInstaller.length <= normCandidate.length ? normInstaller : normCandidate;
    const longer = normInstaller.length <= normCandidate.length ? normCandidate : normInstaller;

    if (shorter.length >= 4 && longer.includes(shorter)) {
      // Make sure the containment is meaningful — the shorter string should be
      // at least 60% of the longer string's length to avoid false positives
      // e.g. "solar" matching "national solar installations" would be too loose
      if (shorter.length / longer.length >= 0.6) {
        return {
          matchIndex: c.index,
          reasoning: `Normalised containment match: "${shorter}" within "${longer}"`,
        };
      }
    }
  }

  return null;
}

// ─── Tier 2: String similarity + postcode ───

interface Tier2Result {
  matchIndex: number;
  similarity: number;
  reasoning: string;
}

function tier2SimilarityMatch(
  installerName: string,
  installerPostcode: string | null,
  candidates: CompanyCandidate[]
): Tier2Result | null {
  const normInstaller = normaliseName(installerName);
  if (!normInstaller) return null;

  const installerDistrict = postcodeDistrict(installerPostcode);

  let best: { index: number; score: number; candidateName: string; postcodeMatches: boolean } | null = null;

  for (const c of candidates) {
    const normCandidate = normaliseName(c.companyName);
    if (!normCandidate) continue;

    const score = jaroWinkler(normInstaller, normCandidate);
    const candidateDistrict = postcodeDistrict(c.postalCode);
    const postcodeMatches =
      installerDistrict != null &&
      candidateDistrict != null &&
      installerDistrict === candidateDistrict;

    if (!best || score > best.score) {
      best = { index: c.index, score, candidateName: normCandidate, postcodeMatches };
    }
  }

  if (!best) return null;

  // High similarity + postcode match
  if (best.score > 0.92 && best.postcodeMatches) {
    return {
      matchIndex: best.index,
      similarity: best.score,
      reasoning: `Similarity ${best.score.toFixed(3)} with postcode district match`,
    };
  }

  // Near-exact without postcode
  if (best.score > 0.97) {
    return {
      matchIndex: best.index,
      similarity: best.score,
      reasoning: `Near-exact similarity ${best.score.toFixed(3)} (no postcode needed)`,
    };
  }

  return null;
}

// ─── Best similarity fallback (used when AI fails) ───

export interface SimilarityRanking {
  index: number;
  score: number;
  postcodeMatches: boolean;
}

export function rankBySimilarity(
  installerName: string,
  installerPostcode: string | null,
  candidates: CompanyCandidate[]
): SimilarityRanking[] {
  const normInstaller = normaliseName(installerName);
  if (!normInstaller) return [];

  const installerDistrict = postcodeDistrict(installerPostcode);

  return candidates
    .map((c) => {
      const normCandidate = normaliseName(c.companyName);
      const score = normCandidate ? jaroWinkler(normInstaller, normCandidate) : 0;
      const candidateDistrict = postcodeDistrict(c.postalCode);
      const postcodeMatches =
        installerDistrict != null &&
        candidateDistrict != null &&
        installerDistrict === candidateDistrict;

      return { index: c.index, score, postcodeMatches };
    })
    .sort((a, b) => {
      // Prefer postcode matches, then higher score
      if (a.postcodeMatches !== b.postcodeMatches) return a.postcodeMatches ? -1 : 1;
      return b.score - a.score;
    });
}

// ─── Main tiered matching function ───

/**
 * Attempt to match an installer to the best Companies House candidate
 * using a tiered approach. Only falls through to AI for genuinely ambiguous cases.
 *
 * @param aiMatchFn - The AI matching function to use for Tier 3. Pass null to skip AI entirely.
 */
export async function tieredCompanyMatch(
  installer: { companyName: string; postcode: string | null; website?: string | null; county?: string | null },
  candidates: CompanyCandidate[],
  aiMatchFn: ((
    installer: { companyName: string; website: string | null; postcode: string | null; county: string | null },
    candidates: CompanyCandidate[]
  ) => Promise<{ matched: boolean; matchIndex: number | null; confidence: "high" | "medium" | "low"; reasoning: string }>) | null
): Promise<TieredMatchResult> {
  if (candidates.length === 0) {
    return {
      matched: false,
      matchIndex: null,
      confidence: "high",
      tier: "none",
      reasoning: "No candidates returned from Companies House search",
    };
  }

  // ── Tier 1: Normalised exact match ──
  const t1 = tier1ExactMatch(installer.companyName, candidates);
  if (t1) {
    return {
      matched: true,
      matchIndex: t1.matchIndex,
      confidence: "high",
      tier: "exact",
      reasoning: t1.reasoning,
      similarityScore: 1.0,
    };
  }

  // ── Tier 2: String similarity + postcode ──
  const t2 = tier2SimilarityMatch(installer.companyName, installer.postcode, candidates);
  if (t2) {
    return {
      matched: true,
      matchIndex: t2.matchIndex,
      confidence: t2.similarity > 0.97 ? "high" : "medium",
      tier: "similarity",
      reasoning: t2.reasoning,
      similarityScore: t2.similarity,
    };
  }

  // ── Pre-Tier-3 check: if best similarity is < 0.6 for ALL candidates, skip AI ──
  const rankings = rankBySimilarity(installer.companyName, installer.postcode, candidates);
  const bestScore = rankings.length > 0 ? rankings[0].score : 0;

  if (bestScore < 0.6) {
    return {
      matched: false,
      matchIndex: null,
      confidence: "high",
      tier: "none",
      reasoning: `Best similarity score ${bestScore.toFixed(3)} is below 0.6 threshold — no plausible match`,
      similarityScore: bestScore,
    };
  }

  // ── Tier 3: AI matching ──
  if (aiMatchFn) {
    try {
      const aiResult = await aiMatchFn(
        {
          companyName: installer.companyName,
          website: installer.website ?? null,
          postcode: installer.postcode,
          county: installer.county ?? null,
        },
        candidates
      );

      if (aiResult.matched && aiResult.matchIndex != null) {
        return {
          matched: true,
          matchIndex: aiResult.matchIndex,
          confidence: aiResult.confidence,
          tier: "ai",
          reasoning: aiResult.reasoning,
          similarityScore: bestScore,
        };
      }

      // AI explicitly rejected all candidates
      return {
        matched: false,
        matchIndex: null,
        confidence: aiResult.confidence,
        tier: "ai",
        reasoning: aiResult.reasoning,
        similarityScore: bestScore,
      };
    } catch {
      // AI unavailable — fall through to similarity-based fallback
    }
  }

  // ── Fallback: use best similarity ranking instead of blindly taking first result ──
  if (rankings.length > 0 && rankings[0].score >= 0.8) {
    const best = rankings[0];
    return {
      matched: true,
      matchIndex: best.index,
      confidence: "low",
      tier: "similarity",
      reasoning: `AI unavailable — fallback to best similarity ${best.score.toFixed(3)}${best.postcodeMatches ? " with postcode match" : ""}`,
      similarityScore: best.score,
    };
  }

  return {
    matched: false,
    matchIndex: null,
    confidence: "low",
    tier: "none",
    reasoning: `AI unavailable and best similarity ${bestScore.toFixed(3)} is below fallback threshold (0.8)`,
    similarityScore: bestScore,
  };
}
