import { db } from "@/lib/db";
import {
  installers,
  companiesHouseData,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { RateLimiter } from "./rate-limiter";
import { robustFetch } from "./fetch-utils";
import { aiMatchCompaniesHouse } from "./ai-matcher";
import { tieredCompanyMatch, type CompanyCandidate } from "./company-matcher";

const BASE_URL = "https://api.company-information.service.gov.uk";

function getAuth() {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    throw new Error("COMPANIES_HOUSE_API_KEY must be set in .env.local");
  }
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

async function chGet(path: string) {
  const res = await robustFetch(
    `${BASE_URL}${path}`,
    { headers: { Authorization: getAuth() } },
    { timeoutMs: 15000, retries: 2, retryDelayMs: 2000, retryOn: (r) => r.status === 429 }
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Companies House API error: ${res.status}`);
  }
  return res.json();
}

export async function enrichCompaniesHouse(
  jobId: number,
  installerIds?: number[]
) {
  // 600 requests per 5 minutes = 2 per second
  // Each installer uses ~6 calls (1 search + 5 parallel detail fetches including charges)
  // With 3 concurrent installers: 3 search + 15 detail = 18 calls per batch
  // Throttle to 1.5/sec for safety margin
  const limiter = new RateLimiter(1.5);

  const query = installerIds
    ? db
        .select({
          id: installers.id,
          companyName: installers.companyName,
          postcode: installers.postcode,
        })
        .from(installers)
        .where(
          sql`${installers.id} IN (${sql.join(
            installerIds.map((id) => sql`${id}`),
            sql`,`
          )})`
        )
    : db
        .select({
          id: installers.id,
          companyName: installers.companyName,
          postcode: installers.postcode,
        })
        .from(installers)
        .leftJoin(
          companiesHouseData,
          eq(installers.id, companiesHouseData.installerId)
        )
        .where(isNull(companiesHouseData.id));

  const toEnrich = await query;

  await db
    .update(enrichmentJobs)
    .set({
      totalItems: toEnrich.length,
      processedItems: 0,
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .where(eq(enrichmentJobs.id, jobId));

  let processed = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Process 3 installers concurrently (stays under 600/5min rate limit)
  for (let i = 0; i < toEnrich.length; i += 3) {
    // Check if job was cancelled
    const [currentJob] = await db
      .select({ status: enrichmentJobs.status })
      .from(enrichmentJobs)
      .where(eq(enrichmentJobs.id, jobId))
      .limit(1);
    if (currentJob?.status === "cancelled") break;

    const batch = toEnrich.slice(i, i + 3);

    const results = await Promise.allSettled(
      batch.map(async (installer) => {
      await limiter.acquire();

      // Search by company name
      const searchResult = await chGet(
        `/search/companies?q=${encodeURIComponent(installer.companyName)}&items_per_page=5`
      );

      if (!searchResult?.items?.length) {
        return;
      }

      // Build candidate list for tiered matching
      const chCandidates: CompanyCandidate[] = searchResult.items.map(
        (item: { title: string; company_number: string; company_status: string; address?: { postal_code?: string; address_line_1?: string; locality?: string }; sic_codes?: string[] }, idx: number) => ({
          index: idx,
          companyName: item.title,
          companyNumber: item.company_number,
          status: item.company_status,
          address: [item.address?.address_line_1, item.address?.locality].filter(Boolean).join(", ") || null,
          postalCode: item.address?.postal_code || null,
          sicCodes: item.sic_codes || null,
        })
      );

      // Tiered matching: exact → similarity → AI (only if ambiguous)
      const matchResult = await tieredCompanyMatch(
        { companyName: installer.companyName, postcode: installer.postcode },
        chCandidates,
        aiMatchCompaniesHouse
      );

      let bestMatch;
      if (matchResult.matched && matchResult.matchIndex != null) {
        bestMatch = searchResult.items[matchResult.matchIndex];
      } else {
        // No match found at any tier — skip this installer
        return;
      }

      const companyNumber = bestMatch.company_number;

      // Fetch profile + officers + PSC + filings in PARALLEL
      // Each acquires its own rate limit token so they're properly spaced
      const rateLimitedChGet = async (path: string) => {
        await limiter.acquire();
        return chGet(path);
      };
      const [profile, officersData, pscData, filingData, chargesData] = await Promise.all([
        rateLimitedChGet(`/company/${companyNumber}`),
        rateLimitedChGet(`/company/${companyNumber}/officers?items_per_page=50`),
        rateLimitedChGet(`/company/${companyNumber}/persons-with-significant-control`),
        rateLimitedChGet(`/company/${companyNumber}/filing-history?items_per_page=10&category=accounts`),
        rateLimitedChGet(`/company/${companyNumber}/charges`),
      ]);
      if (!profile) return;

      const officers = officersData?.items?.map(
        (o: { name: string; officer_role: string; appointed_on?: string; resigned_on?: string }) => ({
          name: o.name, role: o.officer_role, appointedOn: o.appointed_on || null, resignedOn: o.resigned_on || null,
        })
      ) || [];

      const psc = pscData?.items?.map(
        (p: { name?: string; natures_of_control?: string[] }) => ({
          name: p.name, naturesOfControl: p.natures_of_control || [],
        })
      ) || [];

      let latestAccountsUrl: string | null = null;
      let latestAccountsType: string | null = null;
      if (filingData?.items?.length > 0) {
        latestAccountsType = filingData.items[0].description || null;
        latestAccountsUrl = `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history`;
      }

      const chValues = {
        installerId: installer.id,
        companyNumber: profile.company_number,
        companyStatus: profile.company_status,
        incorporationDate: profile.date_of_creation,
        companyType: profile.type,
        sicCodes: profile.sic_codes ? JSON.stringify(profile.sic_codes) : null,
        registeredAddress: profile.registered_office_address
          ? [
              profile.registered_office_address.address_line_1,
              profile.registered_office_address.address_line_2,
              profile.registered_office_address.locality,
              profile.registered_office_address.postal_code,
            ].filter(Boolean).join(", ")
          : null,
        lastAccountsDate: profile.accounts?.last_accounts?.made_up_to || null,
        accountCategory: profile.accounts?.last_accounts?.type || null,
        employeeCount: null,
        officers: officers.length > 0 ? JSON.stringify(officers) : null,
        personsOfControl: psc.length > 0 ? JSON.stringify(psc) : null,
        latestAccountsUrl,
        latestAccountsType,
        hasInsolvencyHistory: profile.has_insolvency_history ?? false,
        hasCharges: (chargesData?.total_count ?? 0) > 0,
        chargesCount: chargesData?.total_count ?? 0,
        fetchedAt: new Date().toISOString(),
      };
      await db.insert(companiesHouseData).values(chValues)
        .onConflictDoUpdate({ target: companiesHouseData.installerId, set: chValues });
    })
    );

    for (const r of results) {
      processed++;
      if (r.status === "rejected") {
        errors++;
        errorLog.push(r.reason?.message || String(r.reason));
      }
    }

    await db
      .update(enrichmentJobs)
      .set({ processedItems: processed, errorCount: errors })
      .where(eq(enrichmentJobs.id, jobId));
  }

  await db
    .update(enrichmentJobs)
    .set({
      processedItems: processed,
      errorCount: errors,
      errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
}
