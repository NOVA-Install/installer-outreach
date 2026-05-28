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
  headquarter?: {
    country?: string;
    parsed?: { countryCode?: string };
  };
}

/**
 * Extract root domain from a URL for comparison.
 * e.g. "https://www.greenlitesolar.co.uk/about" → "greenlitesolar.co.uk"
 */
function extractDomain(url: string): string | null {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Compare two domains for a match.
 * Handles cases like:
 * - Exact match: "greenlitesolar.co.uk" === "greenlitesolar.co.uk"
 * - LinkedIn tracking URLs: "greenlitesolar.co.uk" in "greenlitesolar.co.uk?utm_source=linkedin"
 * - Subdomain differences: "jobs.acme.com" contains "acme.com"
 */
function domainsMatch(installerDomain: string, linkedinDomain: string): boolean {
  if (installerDomain === linkedinDomain) return true;

  // Check if one contains the other (handles subdomains)
  if (installerDomain.endsWith(linkedinDomain) || linkedinDomain.endsWith(installerDomain)) {
    return true;
  }

  // Extract the registerable domain (e.g. "acme.co.uk" from "jobs.acme.co.uk")
  // Simple heuristic: compare last 2-3 parts
  const iParts = installerDomain.split(".");
  const lParts = linkedinDomain.split(".");

  // For .co.uk, .com.au etc. — compare the last 3 parts
  const iKey = iParts.length >= 3 && iParts[iParts.length - 2].length <= 3
    ? iParts.slice(-3).join(".")
    : iParts.slice(-2).join(".");
  const lKey = lParts.length >= 3 && lParts[lParts.length - 2].length <= 3
    ? lParts.slice(-3).join(".")
    : lParts.slice(-2).join(".");

  return iKey === lKey;
}

function extractSlug(linkedinUrl: string): string | null {
  const match = linkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9._-]+)/i);
  return match ? match[1].toLowerCase().replace(/\/$/, "") : null;
}

/**
 * Finds installers with websites but no LinkedIn URL,
 * searches LinkedIn by company name, and saves verified matches.
 */
export async function lookupLinkedInCompanies(options?: {
  maxCompanies?: number;
}): Promise<{ searched: number; matched: number; skipped: number; errors: number }> {
  const { maxCompanies = 100 } = options ?? {};

  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN env var not set");

  // Find installers that have a website but no LinkedIn URL
  // Left join to marketing_signals AND linkedin_company_tracking to exclude already-tracked
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
        // Must have site analysis data (proves website was reachable) OR explicit 'found' status
        sql`(${marketingSignals.installerId} IS NOT NULL OR ${installers.websiteStatus} = 'found')`,
        sql`COALESCE(${installers.websiteStatus}, '') != 'not_found'`, // Exclude known-dead websites
        // No LinkedIn URL found by site analysis
        sql`(${marketingSignals.linkedinUrl} IS NULL OR ${marketingSignals.linkedinUrl} = '')`,
        // Not already tracked
        isNull(linkedinCompanyTracking.id)
      )
    )
    .limit(maxCompanies);

  if (candidates.length === 0) {
    return { searched: 0, matched: 0, skipped: 0, errors: 0 };
  }

  const client = new ApifyClient({ token });

  // Build search list — company names
  const searchNames = candidates
    .map((c) => c.companyName)
    .filter((name) => name.length >= 3); // Skip very short names

  console.log(`[linkedin-lookup] Searching LinkedIn for ${searchNames.length} companies...`);

  // Run the actor with all company names as searches
  // The actor processes them internally with concurrency
  const run = await client.actor(LINKEDIN_COMPANY_ACTOR).call(
    {
      searches: searchNames,
      location: "United Kingdom",
    },
    { waitSecs: 600 } // Up to 10 min for large batches
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log(`[linkedin-lookup] Got ${items.length} results from LinkedIn`);

  // Match results back to candidates.
  // The actor doesn't reliably echo back which search produced which result,
  // so we match each result against all candidates by domain verification.
  // Each result's `website` is compared to each candidate's website.
  const allResults = items.map((item) => item as unknown as LinkedInCompanyResult);

  let matched = 0;
  let skipped = 0;
  let errors = 0;
  const now = new Date().toISOString();
  const usedResults = new Set<number>(); // Track which results have been matched

  for (const candidate of candidates) {
    try {
      const installerDomain = extractDomain(candidate.website!);
      if (!installerDomain) {
        skipped++;
        continue;
      }

      // Find a matching result by domain
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
        const linkedinDomain = extractDomain(bestResult.website!);

        // Update marketingSignals with the LinkedIn URL
        await db
          .update(marketingSignals)
          .set({ linkedinUrl: bestResult.linkedinUrl })
          .where(eq(marketingSignals.installerId, candidate.installerId));

        // Also insert into tracking table
        await db
          .insert(linkedinCompanyTracking)
          .values({
            installerId: candidate.installerId,
            linkedinUrl: bestResult.linkedinUrl!,
            companySlug: slug,
          })
          .onConflictDoNothing();

        matched++;
        console.log(`[linkedin-lookup] MATCHED: ${candidate.companyName} → ${bestResult.name} (${installerDomain} = ${linkedinDomain})`);
      } else {
        // Mark as searched so we don't search again
        await db
          .insert(linkedinCompanyTracking)
          .values({
            installerId: candidate.installerId,
            linkedinUrl: "",
            companySlug: "__not_found__",
          })
          .onConflictDoNothing();

        skipped++;
        console.log(`[linkedin-lookup] SKIPPED: ${candidate.companyName} (no domain match found)`);
      }
    } catch (err) {
      errors++;
      console.error(`[linkedin-lookup] Error processing ${candidate.companyName}:`, err);
    }
  }

  return { searched: candidates.length, matched, skipped, errors };
}

/**
 * Entry point for the enrichment job.
 */
export async function enrichLinkedInCompanyLookup(
  jobId: number,
  options?: { maxCompanies?: number }
): Promise<void> {
  try {
    const result = await lookupLinkedInCompanies(options);

    console.log(
      `[linkedin-lookup] Done: ${result.searched} searched, ${result.matched} matched, ${result.skipped} skipped, ${result.errors} errors`
    );

    await db
      .update(enrichmentJobs)
      .set({
        processedItems: result.searched,
        errorCount: result.errors,
        totalItems: result.searched,
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      .where(eq(enrichmentJobs.id, jobId));
  } catch (err) {
    await db
      .update(enrichmentJobs)
      .set({
        status: "failed",
        errorLog: JSON.stringify([String(err)]),
        completedAt: new Date().toISOString(),
      })
      .where(eq(enrichmentJobs.id, jobId));
    throw err;
  }
}
