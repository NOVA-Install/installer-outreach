import { ApifyClient } from "apify-client";
import { db } from "@/lib/db";
import { installers, linkedinCompanyTracking, linkedinContacts } from "@/lib/db/schema";
import { eq, and, isNotNull, isNull, sql } from "drizzle-orm";

const LINKEDIN_EMPLOYEES_ACTOR = "harvestapi/linkedin-company-employees";

interface BulkEmployeeResult {
  processed: number;
  totalEmployees: number;
  errors: number;
  remaining: number;
}

/**
 * Scrape LinkedIn employees for shortlisted companies that have a LinkedIn URL
 * but haven't had their employees scraped yet (no linkedinContacts).
 */
export async function scrapeLinkedInEmployeesBatch(
  batchSize = 5
): Promise<BulkEmployeeResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  // Find shortlisted companies with LinkedIn tracking but never employee-scraped
  const candidates = await db
    .select({
      installerId: installers.id,
      companyName: installers.companyName,
      linkedinUrl: linkedinCompanyTracking.linkedinUrl,
      companySlug: linkedinCompanyTracking.companySlug,
      trackingId: linkedinCompanyTracking.id,
    })
    .from(installers)
    .innerJoin(
      linkedinCompanyTracking,
      eq(installers.id, linkedinCompanyTracking.installerId)
    )
    .where(
      and(
        eq(installers.isShortlisted, true),
        isNotNull(linkedinCompanyTracking.linkedinUrl),
        sql`${linkedinCompanyTracking.companySlug} != '__not_found__'`,
        isNull(linkedinCompanyTracking.lastScrapedEmployeesAt)
      )
    )
    .limit(batchSize);

  const remaining = candidates.length < batchSize ? 0 : await db
    .select({ count: sql<number>`count(*)` })
    .from(installers)
    .innerJoin(
      linkedinCompanyTracking,
      eq(installers.id, linkedinCompanyTracking.installerId)
    )
    .where(
      and(
        eq(installers.isShortlisted, true),
        isNotNull(linkedinCompanyTracking.linkedinUrl),
        sql`${linkedinCompanyTracking.companySlug} != '__not_found__'`,
        isNull(linkedinCompanyTracking.lastScrapedEmployeesAt)
      )
    )
    .then((r) => Number(r[0]?.count ?? 0) - candidates.length);

  if (candidates.length === 0) {
    return { processed: 0, totalEmployees: 0, errors: 0, remaining: 0 };
  }

  const client = new ApifyClient({ token });
  let totalProcessed = 0;
  let totalEmployees = 0;
  let totalErrors = 0;

  // Process one company at a time (each Apify run takes ~30-60s)
  for (const candidate of candidates) {
    try {
      console.log(
        `[linkedin-employees-bulk] Scraping employees for ${candidate.companyName} (${candidate.linkedinUrl})`
      );

      const run = await client.actor(LINKEDIN_EMPLOYEES_ACTOR).start({
        companies: [candidate.linkedinUrl],
        profileScraperMode: "Short ($4 per 1k)",
        maxItems: 100,
      });

      await client.run(run.id).waitForFinish({ waitSecs: 60 });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const now = new Date().toISOString();

      for (const item of items) {
        const employee = item as Record<string, unknown>;
        const name =
          [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
          (employee.fullName as string);
        if (!name) continue;

        const urn = (employee.id as string) || null;
        if (!urn) continue;

        const publicIdentifier = (employee.publicIdentifier as string) || null;
        const linkedinUrl = (employee.linkedinUrl as string) || null;
        const headline = (employee.headline as string) || null;
        const avatarUrl = (employee.pictureUrl as string) || null;
        const positions = employee.currentPositions as
          | Record<string, unknown>[]
          | undefined;
        const jobTitle = (positions?.[0]?.title as string) || null;
        const location =
          ((employee.location as Record<string, unknown>)
            ?.linkedinText as string) || null;
        const openProfile = (employee.openProfile as boolean) ?? null;
        const premium = (employee.premium as boolean) ?? null;
        const currentPositions = positions ? JSON.stringify(positions) : null;

        await db
          .insert(linkedinContacts)
          .values({
            installerId: candidate.installerId,
            linkedinUrn: urn,
            publicIdentifier,
            profileUrl: linkedinUrl,
            name,
            headline,
            jobTitle,
            avatarUrl,
            location,
            openProfile,
            premium,
            currentPositions,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: [linkedinContacts.installerId, linkedinContacts.linkedinUrn],
            set: {
              name,
              headline,
              jobTitle,
              publicIdentifier,
              profileUrl: linkedinUrl,
              avatarUrl,
              location,
              openProfile,
              premium,
              currentPositions,
              lastSeenAt: now,
            },
          });

        totalEmployees++;
      }

      // Mark as scraped regardless of how many employees were found
      await db
        .update(linkedinCompanyTracking)
        .set({ lastScrapedEmployeesAt: new Date().toISOString() })
        .where(eq(linkedinCompanyTracking.id, candidate.trackingId));

      totalProcessed++;
      console.log(
        `[linkedin-employees-bulk] ${candidate.companyName}: ${items.length} employees found`
      );
    } catch (err) {
      console.error(
        `[linkedin-employees-bulk] Failed for ${candidate.companyName}:`,
        err instanceof Error ? err.message : err
      );
      // Still mark as scraped so we don't retry endlessly
      await db
        .update(linkedinCompanyTracking)
        .set({ lastScrapedEmployeesAt: new Date().toISOString() })
        .where(eq(linkedinCompanyTracking.id, candidate.trackingId))
        .catch(() => {});
      totalErrors++;
    }
  }

  return {
    processed: totalProcessed,
    totalEmployees,
    errors: totalErrors,
    remaining: Math.max(0, remaining),
  };
}

/**
 * Preview: count eligible shortlisted companies for employee scraping
 */
export async function previewLinkedInEmployeesBulk() {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE i.is_shortlisted = true
          AND lct.linkedin_url IS NOT NULL
          AND lct.company_slug != '__not_found__'
          AND lct.last_scraped_employees_at IS NULL
      ) as eligible,
      COUNT(*) FILTER (
        WHERE i.is_shortlisted = true
          AND lct.linkedin_url IS NOT NULL
          AND lct.company_slug != '__not_found__'
      ) as total_with_linkedin,
      COUNT(*) FILTER (
        WHERE i.is_shortlisted = true
      ) as total_shortlisted
    FROM installers i
    LEFT JOIN linkedin_company_tracking lct ON i.id = lct.installer_id
  `);

  const row = (result as unknown as Record<string, unknown>[])[0] || {};

  return {
    eligible: Number(row.eligible || 0),
    totalWithLinkedIn: Number(row.total_with_linkedin || 0),
    totalShortlisted: Number(row.total_shortlisted || 0),
    estimatedCost: `~$${(Number(row.eligible || 0) * 0.004).toFixed(2)}`,
  };
}
