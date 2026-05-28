import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import {
  installers,
  marketingSignals,
  linkedinCompanyTracking,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, sql, and, isNull, isNotNull } from "drizzle-orm";

const LINKEDIN_COMPANY_ACTOR = "harvestapi/linkedin-company";
const BATCH_SIZE = 50; // Companies per Apify actor run — keeps each run under 30s

// Slugs that are platforms, not real installer companies
const BLOCKED_SLUGS = new Set([
  "squarespace", "wix-com", "wix", "wordpress", "wordpress-com", "godaddy",
  "facebook", "google", "linkedin", "twitter", "instagram", "youtube",
  "hubspot", "mailchimp", "shopify", "weebly", "jimdo", "ionos",
  "tawk-to", "zendesk", "intercom", "drift", "crisp",
  "trustpilot", "yell", "checkatrade", "mybuilder",
  "apple", "microsoft", "amazon", "netflix",
]);

interface LinkedInCompanyResult {
  id?: string;
  universalName?: string;
  name?: string;
  linkedinUrl?: string;
  website?: string;
  employeeCount?: number;
  industries?: string[];
}

function extractDomain(url: string): string | null {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function domainsMatch(installerDomain: string, linkedinDomain: string): boolean {
  if (installerDomain === linkedinDomain) return true;
  if (installerDomain.endsWith(linkedinDomain) || linkedinDomain.endsWith(installerDomain)) return true;

  const iParts = installerDomain.split(".");
  const lParts = linkedinDomain.split(".");
  const iKey = iParts.length >= 3 && iParts[iParts.length - 2].length <= 3
    ? iParts.slice(-3).join(".") : iParts.slice(-2).join(".");
  const lKey = lParts.length >= 3 && lParts[lParts.length - 2].length <= 3
    ? lParts.slice(-3).join(".") : lParts.slice(-2).join(".");
  return iKey === lKey;
}

function extractSlug(linkedinUrl: string): string | null {
  const match = linkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9._-]+)/i);
  return match ? match[1].toLowerCase().replace(/\/$/, "") : null;
}

/**
 * Process a single batch of candidates against Apify results.
 */
async function processResults(
  candidates: { installerId: number; companyName: string; website: string | null }[],
  items: unknown[]
): Promise<{ matched: number; skipped: number; errors: number }> {
  const allResults = items.map((item) => item as unknown as LinkedInCompanyResult);
  let matched = 0;
  let skipped = 0;
  let errors = 0;
  const usedResults = new Set<number>();

  for (const candidate of candidates) {
    try {
      const installerDomain = extractDomain(candidate.website!);
      if (!installerDomain) { skipped++; continue; }

      let bestResult: LinkedInCompanyResult | null = null;
      let bestIdx = -1;

      for (let i = 0; i < allResults.length; i++) {
        if (usedResults.has(i)) continue;
        const result = allResults[i];
        if (!result.linkedinUrl || !result.universalName) continue;
        if (BLOCKED_SLUGS.has(result.universalName.toLowerCase())) continue;

        const linkedinDomain = result.website ? extractDomain(result.website) : null;
        if (linkedinDomain && domainsMatch(installerDomain, linkedinDomain)) {
          bestResult = result;
          bestIdx = i;
          break;
        }
      }

      if (bestResult && bestIdx >= 0 && bestResult.linkedinUrl) {
        usedResults.add(bestIdx);
        const slug = extractSlug(bestResult.linkedinUrl!) || bestResult.universalName!.toLowerCase();

        await db.update(marketingSignals)
          .set({ linkedinUrl: bestResult.linkedinUrl })
          .where(eq(marketingSignals.installerId, candidate.installerId));

        await db.insert(linkedinCompanyTracking)
          .values({ installerId: candidate.installerId, linkedinUrl: bestResult.linkedinUrl!, companySlug: slug })
          .onConflictDoNothing();

        matched++;
        console.log(`[linkedin-lookup] MATCHED: ${candidate.companyName} → ${bestResult.name}`);
      } else {
        await db.insert(linkedinCompanyTracking)
          .values({ installerId: candidate.installerId, linkedinUrl: "", companySlug: "__not_found__" })
          .onConflictDoNothing();

        skipped++;
      }
    } catch (err) {
      errors++;
      console.error(`[linkedin-lookup] Error processing ${candidate.companyName}:`, err);
    }
  }

  return { matched, skipped, errors };
}

/**
 * Runs one batch of company lookups. Called repeatedly by the API route.
 * Returns { done: true } when no more candidates remain.
 */
export async function lookupLinkedInCompaniesBatch(options?: {
  batchSize?: number;
}): Promise<{ searched: number; matched: number; skipped: number; errors: number; remaining: number }> {
  const batchSize = options?.batchSize ?? BATCH_SIZE;

  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN env var not set");

  const candidates = await db
    .select({
      installerId: installers.id,
      companyName: installers.companyName,
      website: installers.website,
    })
    .from(installers)
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(linkedinCompanyTracking, eq(installers.id, linkedinCompanyTracking.installerId))
    .where(
      and(
        isNotNull(installers.website),
        sql`${installers.website} != ''`,
        sql`(${marketingSignals.installerId} IS NOT NULL OR ${installers.websiteStatus} = 'found')`,
        sql`COALESCE(${installers.websiteStatus}, '') != 'not_found'`,
        sql`(${marketingSignals.linkedinUrl} IS NULL OR ${marketingSignals.linkedinUrl} = '')`,
        isNull(linkedinCompanyTracking.id)
      )
    )
    .limit(batchSize);

  if (candidates.length === 0) {
    return { searched: 0, matched: 0, skipped: 0, errors: 0, remaining: 0 };
  }

  const client = new ApifyClient({ token });
  const searchNames = candidates.map((c) => c.companyName).filter((n) => n.length >= 3);

  console.log(`[linkedin-lookup] Batch: searching ${searchNames.length} companies...`);

  const run = await client.actor(LINKEDIN_COMPANY_ACTOR).call(
    { searches: searchNames, location: "United Kingdom" },
    { waitSecs: 120 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const result = await processResults(candidates, items);

  // Count remaining
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(installers)
    .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
    .leftJoin(linkedinCompanyTracking, eq(installers.id, linkedinCompanyTracking.installerId))
    .where(
      and(
        isNotNull(installers.website),
        sql`${installers.website} != ''`,
        sql`(${marketingSignals.installerId} IS NOT NULL OR ${installers.websiteStatus} = 'found')`,
        sql`COALESCE(${installers.websiteStatus}, '') != 'not_found'`,
        sql`(${marketingSignals.linkedinUrl} IS NULL OR ${marketingSignals.linkedinUrl} = '')`,
        isNull(linkedinCompanyTracking.id)
      )
    );

  console.log(`[linkedin-lookup] Batch done: ${result.matched} matched, ${result.skipped} skipped, ${Number(count)} remaining`);

  return { searched: candidates.length, ...result, remaining: Number(count) };
}
