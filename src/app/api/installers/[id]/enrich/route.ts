import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  trustpilotReviews,
  reviewItems,
  companiesHouseData,
  marketingSignals,
  seoData,
  trafficData,
  keywordData,
  dataforseoTasks,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// Inline single-installer enrichment to avoid the batch job overhead

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  const body = await request.json();
  const source = body.source;
  const reviewMode = body.reviewMode || "aggregate";
  // Normalize: "live" treated as "priority" for backwards compat
  const priority: "priority" | "standard" = body.priority === "standard" ? "standard" : "priority";

  const [installer] = await db
    .select()
    .from(installers)
    .where(eq(installers.id, installerId))
    .limit(1);

  if (!installer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // Companies House
  if (source === "all" || source === "companies_house") {
    try {
      const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
      if (!apiKey) throw new Error("COMPANIES_HOUSE_API_KEY not set");

      const auth =
        "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

      const searchRes = await fetch(
        `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(installer.companyName)}&items_per_page=5`,
        { headers: { Authorization: auth } }
      );
      if (!searchRes.ok)
        throw new Error(`CH search failed: ${searchRes.status}`);

      const searchData = await searchRes.json();
      if (searchData.items?.length > 0) {
        let bestMatch = searchData.items[0];
        if (installer.postcode) {
          const prefix = installer.postcode.split(" ")[0].toUpperCase();
          const byPostcode = searchData.items.find(
            (item: { address?: { postal_code?: string } }) =>
              item.address?.postal_code?.toUpperCase().startsWith(prefix)
          );
          if (byPostcode) bestMatch = byPostcode;
        }

        const companyNumber = bestMatch.company_number;
        const chGet = (path: string) =>
          fetch(`https://api.company-information.service.gov.uk${path}`, {
            headers: { Authorization: auth },
          }).then((r) => (r.ok ? r.json() : null));

        // Fetch all data in parallel
        const [profile, officersData, pscData, filingData, chargesData] =
          await Promise.all([
            chGet(`/company/${companyNumber}`),
            chGet(`/company/${companyNumber}/officers?items_per_page=50`),
            chGet(`/company/${companyNumber}/persons-with-significant-control`),
            chGet(`/company/${companyNumber}/filing-history?items_per_page=10&category=accounts`),
            chGet(`/company/${companyNumber}/charges`),
          ]);

        if (profile) {
          // Parse officers
          const officers = officersData?.items?.map(
            (o: { name: string; officer_role: string; appointed_on?: string; resigned_on?: string }) => ({
              name: o.name,
              role: o.officer_role,
              appointedOn: o.appointed_on || null,
              resignedOn: o.resigned_on || null,
            })
          ) || [];

          // Parse PSC
          const psc = pscData?.items?.map(
            (p: { name?: string; name_elements?: { title?: string; forename?: string; surname?: string }; natures_of_control?: string[] }) => ({
              name: p.name || [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" "),
              naturesOfControl: p.natures_of_control || [],
            })
          ) || [];

          // Find latest accounts filing and build the Companies House URL
          let latestAccountsUrl: string | null = null;
          let latestAccountsType: string | null = null;
          if (filingData?.items?.length > 0) {
            const latestFiling = filingData.items[0];
            latestAccountsType = latestFiling.description || latestFiling.type || null;
            // Direct link to view on Companies House
            latestAccountsUrl = `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history`;
          }

          // Charges
          const hasCharges = (chargesData?.total_count ?? 0) > 0;
          const chargesCount = chargesData?.total_count ?? 0;

          // Insolvency flag from profile
          const hasInsolvencyHistory = profile.has_insolvency_history ?? false;

          // Delete existing and insert fresh
          await db
            .delete(companiesHouseData)
            .where(eq(companiesHouseData.installerId, installerId));

          await db.insert(companiesHouseData).values({
            installerId,
            companyNumber: profile.company_number,
            companyStatus: profile.company_status,
            incorporationDate: profile.date_of_creation,
            companyType: profile.type,
            sicCodes: profile.sic_codes
              ? JSON.stringify(profile.sic_codes)
              : null,
            registeredAddress: profile.registered_office_address
              ? [
                  profile.registered_office_address.address_line_1,
                  profile.registered_office_address.address_line_2,
                  profile.registered_office_address.locality,
                  profile.registered_office_address.postal_code,
                ]
                  .filter(Boolean)
                  .join(", ")
              : null,
            lastAccountsDate:
              profile.accounts?.last_accounts?.made_up_to || null,
            accountCategory:
              profile.accounts?.last_accounts?.type || null,
            employeeCount: null,
            officers: officers.length > 0 ? JSON.stringify(officers) : null,
            personsOfControl: psc.length > 0 ? JSON.stringify(psc) : null,
            latestAccountsUrl,
            latestAccountsType,
            hasInsolvencyHistory,
            hasCharges,
            chargesCount,
            fetchedAt: new Date().toISOString(),
          });

          results.companies_house = {
            companyNumber: profile.company_number,
            status: profile.company_status,
            officers: officers.length,
            psc: psc.length,
            hasCharges,
            hasInsolvencyHistory,
          };
        }
      } else {
        results.companies_house = { message: "No match found" };
      }
    } catch (err) {
      errors.push(
        `Companies House: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Tech Detection
  if (source === "all" || source === "tech_detection") {
    if (!installer.website) {
      results.tech_detection = { message: "No website URL" };
    } else {
      try {
        const url = installer.website.startsWith("http")
          ? installer.website
          : `https://${installer.website}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; InstallerCRM/1.0)",
          },
          redirect: "follow",
        });
        clearTimeout(timeout);

        const html = await res.text();
        const lowerHtml = html.toLowerCase();

        const detected: string[] = [];
        const checks = {
          hasGoogleAnalytics: ["gtag(", "google-analytics.com", "googletagmanager.com", "analytics.js", "g-", "ua-"].some((p) => lowerHtml.includes(p)),
          hasGoogleAds: ["aw-", "googleadservices.com", "google_conversion", "conversion.js", "googleads.g.doubleclick.net", "googlesyndication.com", "adservice.google.com", "ads/ga-audiences"].some((p) => lowerHtml.includes(p)),
          hasMetaPixel: ["fbq(", "connect.facebook.net", "facebook.com/tr"].some((p) => lowerHtml.includes(p)),
          hasCrmTool: false,
          crmToolName: null as string | null,
          hasLiveChat: false,
          liveChatTool: null as string | null,
        };

        if (checks.hasGoogleAnalytics) detected.push("Google Analytics");
        if (checks.hasGoogleAds) detected.push("Google Ads");
        if (checks.hasMetaPixel) detected.push("Meta Pixel");

        const crmPatterns: [string, string][] = [["hubspot", "HubSpot"], ["salesforce", "Salesforce"], ["zoho", "Zoho"], ["pipedrive", "Pipedrive"], ["activecampaign", "ActiveCampaign"]];
        for (const [pattern, name] of crmPatterns) {
          if (lowerHtml.includes(pattern)) { checks.hasCrmTool = true; checks.crmToolName = name; detected.push(name); break; }
        }

        const chatPatterns: [string, string][] = [["tawk.to", "Tawk.to"], ["intercom", "Intercom"], ["drift", "Drift"], ["crisp.chat", "Crisp"], ["zendesk", "Zendesk"], ["livechat", "LiveChat"]];
        for (const [pattern, name] of chatPatterns) {
          if (lowerHtml.includes(pattern)) { checks.hasLiveChat = true; checks.liveChatTool = name; detected.push(name); break; }
        }

        if (["bat.bing.com", "uetag", "clarity.ms"].some((p) => lowerHtml.includes(p))) detected.push("Microsoft Ads");
        if (lowerHtml.includes("googletagmanager.com/gtm.js")) detected.push("Google Tag Manager");
        if (lowerHtml.includes("hotjar.com")) detected.push("Hotjar");
        if (lowerHtml.includes("mailchimp.com") || lowerHtml.includes("list-manage.com")) detected.push("Mailchimp");

        await db
          .delete(marketingSignals)
          .where(eq(marketingSignals.installerId, installerId));

        await db.insert(marketingSignals).values({
          installerId,
          hasMetaAds: null,
          metaAdCount: null,
          metaAdLastSeen: null,
          hasGoogleAnalytics: checks.hasGoogleAnalytics,
          hasGoogleAds: checks.hasGoogleAds,
          hasMetaPixel: checks.hasMetaPixel,
          hasCrmTool: checks.hasCrmTool,
          crmToolName: checks.crmToolName,
          hasLiveChat: checks.hasLiveChat,
          liveChatTool: checks.liveChatTool,
          detectedTechnologies: JSON.stringify(detected),
          estimatedMonthlyTraffic: null,
          estimatedAdSpend: null,
          fetchedAt: new Date().toISOString(),
        });

        results.tech_detection = { detected };
      } catch (err) {
        errors.push(
          `Tech Detection: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Helper: poll DataForSEO task_get until ready
  // priority "priority" (high) = poll up to 2 min (usually ready in ~1 min)
  // priority "live" = poll up to 2 min
  // priority "standard" = don't poll, return task ID for later retrieval
  async function pollTaskGet(
    auth: string,
    taskId: string,
    basePath: string,
    maxSeconds = 120
  ): Promise<unknown> {
    const maxAttempts = Math.ceil(maxSeconds / 5);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(
        `https://api.dataforseo.com/v3/${basePath}/task_get/${taskId}`,
        { headers: { Authorization: auth } }
      );
      const data = await res.json();
      const task = data?.tasks?.[0];
      // 20000 = completed with results
      if (task?.status_code === 20000 && task?.result) {
        return task.result[0];
      }
      // 40601 = not found yet, 40602 = in queue - keep polling
      if (task?.status_code === 40601 || task?.status_code === 40602) {
        continue;
      }
      // Any other 4xxxx/5xxxx = actual error
      if (
        task?.status_code &&
        task.status_code >= 40000 &&
        task.status_code !== 40601 &&
        task.status_code !== 40602
      ) {
        throw new Error(
          `Task failed ${task.status_code}: ${task.status_message}`
        );
      }
    }
    return null; // Timed out - return null instead of throwing
  }

  // DataForSEO Google Reviews (async: task_post → poll → task_get)
  if (source === "all" || source === "google_reviews") {
    try {
      const login = process.env.DATAFORSEO_LOGIN;
      const password = process.env.DATAFORSEO_PASSWORD;
      if (!login || !password) throw new Error("DATAFORSEO credentials not set");

      const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
      const searchQuery = `${installer.companyName} solar installer ${installer.postcode || ""}`.trim();
      const depth = reviewMode === "individual" ? 100 : 10;

      // Step 1: Post task
      const res = await fetch("https://api.dataforseo.com/v3/business_data/google/reviews/task_post", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([{
          keyword: searchQuery,
          location_name: "United Kingdom",
          language_name: "English",
          depth,
          ...(priority === "priority" ? { priority: 2 } : {}),
        }]),
      });

      const data = await res.json();
      if (data.status_code !== 20000) {
        throw new Error(`API error ${data.status_code}: ${data.status_message}`);
      }
      const task = data?.tasks?.[0];
      if (!task || task.status_code !== 20100) {
        throw new Error(`Task error ${task?.status_code}: ${task?.status_message || "Failed to create task"}`);
      }

      // Save task to DB for tracking
      await db.insert(dataforseoTasks).values({
        installerId,
        taskId: task.id,
        source: "google_reviews",
        endpoint: "business_data/google/reviews",
        status: "pending",
        searchTerm: searchQuery,
      });

      // Step 2: Poll for results or return task ID
      const pollTime = priority === "standard" ? 0 : 120;
      let result: Record<string, unknown> | null = null;

      if (pollTime === 0) {
        results.google_reviews = {
          message: `Task queued (standard, up to 45 min). Check the Tasks panel to retrieve results.`,
          taskId: task.id,
        };
      } else {
        result = await pollTaskGet(auth, task.id, "business_data/google/reviews", pollTime) as Record<string, unknown> | null;

        if (!result) {
          results.google_reviews = {
            message: `Task still processing. Check the Tasks panel to retrieve results when ready.`,
            taskId: task.id,
          };
        }
      }

      // Extract aggregate data from result
      const ratingObj = result?.rating as { value?: number } | number | undefined;
      const ratingVal = ratingObj ? (typeof ratingObj === "object" ? ratingObj.value : ratingObj) : null;
      const reviewsCount = (result?.reviews_count as number) || 0;
      const items = result?.items as Array<{ type?: string; rating?: { value?: number }; review_text?: string; profile_name?: string; timestamp?: string }> | undefined;

      // Only update aggregate data if we got a valid rating (don't overwrite existing data with nothing)
      if (ratingVal) {
        await db.delete(googleReviews).where(eq(googleReviews.installerId, installerId));

        const reviewsPerMonth = reviewsCount > 0 ? reviewsCount / 36 : null;
        await db.insert(googleReviews).values({
          installerId,
          placeId: (result?.place_id as string) || null,
          rating: ratingVal,
          reviewCount: reviewsCount,
          reviewsPerMonth,
          businessStatus: null,
          fetchedAt: new Date().toISOString(),
        });
      }

      // Store individual reviews if requested (independent of aggregate update)
      if (reviewMode === "individual" && items?.length) {
        const reviewsToStore = items
          .filter((item) => item.type === "google_review")
          .map((item) => ({
            installerId,
            source: "google" as const,
            rating: item.rating?.value || null,
            reviewText: item.review_text || null,
            reviewerName: item.profile_name || null,
            reviewDate: item.timestamp || null,
            fetchedAt: new Date().toISOString(),
          }));
        if (reviewsToStore.length > 0) {
          await db.delete(reviewItems).where(
            sql`${reviewItems.installerId} = ${installerId} AND ${reviewItems.source} = 'google'`
          );
          await db.insert(reviewItems).values(reviewsToStore);
        }
      }

      // Calculate cost to fetch all individual reviews
      const costPer10 = priority === "standard" ? 0.00075 : 0.0015;
      // Use existing review count if we didn't get a new one
      const existingReviewCount = ratingVal ? reviewsCount : (
        await db.select({ reviewCount: googleReviews.reviewCount }).from(googleReviews).where(eq(googleReviews.installerId, installerId)).limit(1)
      )[0]?.reviewCount ?? 0;
      const individualReviewsCost = Math.ceil(existingReviewCount / 10) * costPer10;

      // Mark task
      if (ratingVal || (items?.length ?? 0) > 0) {
        await db.update(dataforseoTasks)
          .set({ status: "completed", resultSummary: `Rating: ${ratingVal ?? "kept existing"}, ${items?.length ?? 0} individual reviews fetched`, completedAt: new Date().toISOString() })
          .where(eq(dataforseoTasks.taskId, task.id));

        results.google_reviews = {
          rating: ratingVal ?? "existing kept",
          reviewCount: existingReviewCount,
          reviewsFetched: items?.length || 0,
          mode: reviewMode,
          priority,
          individualReviewsCost: `$${individualReviewsCost.toFixed(4)}`,
          individualReviewsCostNote: `${existingReviewCount} reviews = ${Math.ceil(existingReviewCount / 10)} batches of 10 @ $${costPer10}/batch`,
        };
      } else {
        await db.update(dataforseoTasks)
          .set({ status: "no_results", resultSummary: `No listing found for "${searchQuery}"`, completedAt: new Date().toISOString() })
          .where(eq(dataforseoTasks.taskId, task.id));

        results.google_reviews = {
          message: `No Google business listing found for "${searchQuery}"`,
          searchQuery,
        };
      }
    } catch (err) {
      errors.push(`Google Reviews: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // DataForSEO Trustpilot
  if (source === "all" || source === "trustpilot") {
    try {
      const login = process.env.DATAFORSEO_LOGIN;
      const password = process.env.DATAFORSEO_PASSWORD;
      if (!login || !password) throw new Error("DATAFORSEO credentials not set");

      const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");

      // Check if we already have a Trustpilot domain stored (skip search if so)
      const [existingTp] = await db
        .select({ trustpilotUrl: trustpilotReviews.trustpilotUrl })
        .from(trustpilotReviews)
        .where(eq(trustpilotReviews.installerId, installerId))
        .limit(1);

      let knownDomain: string | null = null;
      if (existingTp?.trustpilotUrl) {
        const match = existingTp.trustpilotUrl.match(/trustpilot\.com\/review\/(.+)/);
        if (match) knownDomain = match[1];
      }

      // Individual reviews require a known domain from a previous aggregate search
      if (reviewMode === "individual" && !knownDomain) {
        results.trustpilot = {
          message: "Run aggregate search first to find the Trustpilot profile, then fetch individual reviews.",
        };
        throw { __skip: true };
      }

      // If individual mode with known domain: skip search, go straight to reviews
      if (reviewMode === "individual" && knownDomain) {
        // Fetch individual reviews directly using stored domain
        const reviewPostRes = await fetch("https://api.dataforseo.com/v3/business_data/trustpilot/reviews/task_post", {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify([{
            domain: knownDomain,
            depth: 200,
            ...(priority === "priority" ? { priority: 2 } : {}),
          }]),
        });

        const reviewPostData = await reviewPostRes.json();
        if (reviewPostData.status_code !== 20000) {
          throw new Error(`API error ${reviewPostData.status_code}: ${reviewPostData.status_message}`);
        }
        const reviewTask = reviewPostData?.tasks?.[0];

        if (reviewTask?.status_code === 20100) {
          await db.insert(dataforseoTasks).values({
            installerId,
            taskId: reviewTask.id,
            source: "trustpilot_reviews",
            endpoint: "business_data/trustpilot/reviews",
            status: "pending",
            searchTerm: knownDomain,
          });

          if (priority === "standard") {
            results.trustpilot = {
              message: `Individual reviews task queued for ${knownDomain} (standard, up to 45 min). Check Tasks panel later.`,
              taskId: reviewTask.id,
            };
          } else {
            const reviewResult = await pollTaskGet(auth, reviewTask.id, "business_data/trustpilot/reviews", 120) as { items?: Array<{ rating?: { value?: number }; review_text?: string; user_profile?: { name?: string }; timestamp?: string }> } | null;

            if (reviewResult?.items?.length) {
              await db.delete(reviewItems).where(
                sql`${reviewItems.installerId} = ${installerId} AND ${reviewItems.source} = 'trustpilot'`
              );
              const tpReviews = reviewResult.items.map((item) => ({
                installerId,
                source: "trustpilot" as const,
                rating: item.rating?.value || null,
                reviewText: item.review_text || null,
                reviewerName: item.user_profile?.name || null,
                reviewDate: item.timestamp || null,
                fetchedAt: new Date().toISOString(),
              }));
              await db.insert(reviewItems).values(tpReviews);

              await db.update(dataforseoTasks)
                .set({ status: "completed", resultSummary: `${tpReviews.length} individual reviews fetched`, completedAt: new Date().toISOString() })
                .where(eq(dataforseoTasks.taskId, reviewTask.id));

              results.trustpilot = {
                reviewsFetched: tpReviews.length,
                domain: knownDomain,
                mode: "individual",
              };
            } else {
              await db.update(dataforseoTasks)
                .set({ status: reviewResult ? "no_results" : "pending", resultSummary: reviewResult ? "No reviews returned" : "Still processing", completedAt: reviewResult ? new Date().toISOString() : null })
                .where(eq(dataforseoTasks.taskId, reviewTask.id));

              results.trustpilot = {
                message: reviewResult ? `No individual reviews returned for ${knownDomain}` : "Task still processing. Check Tasks panel.",
                taskId: reviewTask.id,
              };
            }
          }
        }

        throw { __skip: true };
      }

      // Aggregate mode: search for the Trustpilot profile
      const searchTermsToTry: string[] = [installer.companyName];
      if (installer.website) {
        const hostname = new URL(
          installer.website.startsWith("http") ? installer.website : `https://${installer.website}`
        ).hostname.replace(/^www\./, "");
        // Extract name from domain (e.g. "macbrookgas" from "macbrookgas.co.uk")
        const domainName = hostname.split(".")[0];
        if (domainName !== installer.companyName.toLowerCase()) {
          searchTermsToTry.push(domainName);
        }
        searchTermsToTry.push(hostname);
      }

      // Aggregate mode always searches to get fresh rating data
      type TpSearchResult = { items?: Array<{ domain?: string; rating?: { value?: number }; reviews_count?: number; trust_score?: number }>; total_count?: number };
      let searchTask: { id: string; status_code: number; status_message?: string } | null = null;
      let searchResult: TpSearchResult | null = null;
      let searchTermUsed = searchTermsToTry[0];

      for (const term of searchTermsToTry) {
        const searchRes = await fetch("https://api.dataforseo.com/v3/business_data/trustpilot/search/task_post", {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify([{ keyword: term, depth: 10 }]),
        });

        const searchData = await searchRes.json();
        if (searchData.status_code !== 20000) {
          throw new Error(`API error ${searchData.status_code}: ${searchData.status_message}`);
        }
        searchTask = searchData?.tasks?.[0];
        if (!searchTask || searchTask.status_code !== 20100) {
          continue;
        }

        searchTermUsed = term;

        // Save task to DB
        await db.insert(dataforseoTasks).values({
          installerId,
          taskId: searchTask.id,
          source: "trustpilot_search",
          endpoint: "business_data/trustpilot/search",
          status: "pending",
          searchTerm: term,
        });

        // For standard priority, don't poll
        const tpPollTime = priority === "standard" ? 0 : 120;
        if (tpPollTime === 0) {
          results.trustpilot = {
            message: `Task queued for "${term}" (standard, up to 45 min). Check the Tasks panel to retrieve results.`,
            taskId: searchTask.id,
          };
          throw { __skip: true };
        }

        // Poll for results
        searchResult = await pollTaskGet(auth, searchTask.id, "business_data/trustpilot/search", tpPollTime) as TpSearchResult | null;

        if (!searchResult) {
          results.trustpilot = {
            message: `Task still processing for "${term}" after 2 min. Task ID: ${searchTask.id}. Try again shortly.`,
            taskId: searchTask.id,
          };
          throw { __skip: true };
        }

        // If we got results, stop trying
        if (searchResult?.items?.length) {
          break;
        }
      }

      if (!searchTask) {
        throw new Error("Failed to create any search tasks");
      }

      const searchItems = searchResult?.items;

      if (searchItems?.length) {
        const biz = searchItems[0];

        // Only update aggregate data if we have a real rating (don't overwrite with cached/empty data)
        if (biz.rating?.value != null) {
          await db.delete(trustpilotReviews).where(eq(trustpilotReviews.installerId, installerId));
          await db.insert(trustpilotReviews).values({
            installerId,
            trustpilotUrl: biz.domain ? `https://www.trustpilot.com/review/${biz.domain}` : null,
            rating: biz.rating.value,
            reviewCount: biz.reviews_count || 0,
            trustScore: biz.trust_score || null,
            fetchedAt: new Date().toISOString(),
          });
        }

        // Mark task as completed
        if (searchTask) {
          await db.update(dataforseoTasks)
            .set({ status: "completed", resultSummary: `Found: ${biz.domain}, rating: ${biz.rating?.value}`, completedAt: new Date().toISOString() })
            .where(eq(dataforseoTasks.taskId, searchTask.id));
        }

        // Calculate cost to fetch all individual reviews
        // Trustpilot: billed per 20 reviews. Standard: $0.00075/20, Priority: $0.0015/20
        const tpReviewCount = biz.reviews_count || 0;
        const tpCostPer20 = priority === "standard" ? 0.00075 : 0.0015;
        const tpIndividualCost = Math.ceil(tpReviewCount / 20) * tpCostPer20;

        results.trustpilot = {
          rating: biz.rating?.value,
          reviewCount: tpReviewCount,
          domain: biz.domain,
          trustpilotUrl: biz.domain ? `https://www.trustpilot.com/review/${biz.domain}` : null,
          matchedOn: searchTermUsed,
          mode: reviewMode,
          priority,
          individualReviewsCost: `$${tpIndividualCost.toFixed(4)}`,
          individualReviewsCostNote: `${tpReviewCount} reviews = ${Math.ceil(tpReviewCount / 20)} batches of 20 @ $${tpCostPer20}/batch`,
        };
      } else {
        // Mark task as no results
        if (searchTask) {
          await db.update(dataforseoTasks)
            .set({ status: "no_results", resultSummary: `No profile found. Tried: ${searchTermsToTry.join(", ")}`, completedAt: new Date().toISOString() })
            .where(eq(dataforseoTasks.taskId, searchTask.id));
        }

        results.trustpilot = {
          message: `No Trustpilot profile found. Tried: ${searchTermsToTry.join(", ")}`,
          searchTermsTried: searchTermsToTry,
          totalResults: searchResult?.total_count ?? 0,
        };
      }
    } catch (err) {
      if (err && typeof err === "object" && "__skip" in err) {
        // Not an error, just skipping because task is queued
      } else {
        errors.push(`Trustpilot: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // DataForSEO Backlinks/SEO
  if (source === "all" || source === "seo") {
    if (!installer.website) {
      results.seo = { message: "No website URL" };
    } else {
      try {
        const login = process.env.DATAFORSEO_LOGIN;
        const password = process.env.DATAFORSEO_PASSWORD;
        if (!login || !password) throw new Error("DATAFORSEO credentials not set");

        const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
        const domain = installer.website.startsWith("http")
          ? new URL(installer.website).hostname
          : installer.website.replace(/^www\./, "");

        const res = await fetch("https://api.dataforseo.com/v3/backlinks/summary/live", {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify([{ target: domain }]),
        });

        const data = await res.json();

        if (data.status_code !== 20000) {
          throw new Error(`API error ${data.status_code}: ${data.status_message}`);
        }

        const task = data?.tasks?.[0];
        if (task?.status_code !== 20000) {
          throw new Error(`Task error ${task?.status_code}: ${task?.status_message || "Unknown"}`);
        }

        const result = task?.result?.[0];

        if (result) {
          await db.delete(seoData).where(eq(seoData.installerId, installerId));
          await db.insert(seoData).values({
            installerId,
            domainAuthority: result.rank || null,
            backlinksCount: result.backlinks || 0,
            referringDomains: result.referring_domains || 0,
            organicKeywords: null,
            fetchedAt: new Date().toISOString(),
          });
          results.seo = {
            rank: result.rank,
            backlinks: result.backlinks,
            referringDomains: result.referring_domains,
            domain,
          };
        } else {
          results.seo = {
            message: `No backlink data found for "${domain}"`,
            domain,
            apiStatus: task?.status_code,
            apiMessage: task?.status_message,
          };
        }
      } catch (err) {
        errors.push(`SEO: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // DataForSEO Traffic Estimation (bulk endpoint for single domain)
  if (source === "all" || source === "traffic_bulk") {
    if (!installer.website) {
      results.traffic_bulk = { message: "No website URL" };
    } else {
      try {
        const login = process.env.DATAFORSEO_LOGIN;
        const password = process.env.DATAFORSEO_PASSWORD;
        if (!login || !password) throw new Error("DATAFORSEO credentials not set");

        const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
        const domain = installer.website.startsWith("http")
          ? new URL(installer.website).hostname.replace(/^www\./, "")
          : installer.website.replace(/^www\./, "");

        // Fetch Google + Bing in parallel
        const [googleRes, bingRes] = await Promise.all([
          fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_traffic_estimation/live", {
            method: "POST",
            headers: { Authorization: auth, "Content-Type": "application/json" },
            body: JSON.stringify([{
              targets: [domain],
              location_name: "United Kingdom",
              language_name: "English",
              item_types: ["organic", "paid", "featured_snippet", "local_pack"],
            }]),
          }),
          fetch("https://api.dataforseo.com/v3/dataforseo_labs/bing/bulk_traffic_estimation/live", {
            method: "POST",
            headers: { Authorization: auth, "Content-Type": "application/json" },
            body: JSON.stringify([{
              targets: [domain],
              location_name: "United Kingdom",
              language_name: "English",
              item_types: ["organic", "paid"],
            }]),
          }),
        ]);

        const googleData = await googleRes.json();
        const bingData = await bingRes.json();

        const gItem = googleData?.tasks?.[0]?.result?.[0]?.items?.[0];
        const bItem = bingData?.tasks?.[0]?.result?.[0]?.items?.[0];

        await db.delete(trafficData).where(eq(trafficData.installerId, installerId));

        await db.insert(trafficData).values({
          installerId,
          googleOrganicEtv: gItem?.metrics?.organic?.etv ?? null,
          googleOrganicCount: gItem?.metrics?.organic?.count ?? null,
          googleOrganicTrafficCost: null,
          googlePaidEtv: gItem?.metrics?.paid?.etv ?? null,
          googlePaidCount: gItem?.metrics?.paid?.count ?? null,
          googlePaidTrafficCost: null,
          googleFeaturedSnippetEtv: gItem?.metrics?.featured_snippet?.etv ?? null,
          googleLocalPackEtv: gItem?.metrics?.local_pack?.etv ?? null,
          googleOrganicPos1: null,
          googleOrganicPos2_3: null,
          googleOrganicPos4_10: null,
          googleOrganicPos11_20: null,
          googleOrganicIsNew: null,
          googleOrganicIsUp: null,
          googleOrganicIsDown: null,
          googleOrganicIsLost: null,
          googlePaidPos1: null,
          googlePaidPos2_3: null,
          googlePaidPos4_10: null,
          bingOrganicEtv: bItem?.metrics?.organic?.etv ?? null,
          bingOrganicCount: bItem?.metrics?.organic?.count ?? null,
          bingPaidEtv: bItem?.metrics?.paid?.etv ?? null,
          bingPaidCount: bItem?.metrics?.paid?.count ?? null,
          source: "bulk",
          fetchedAt: new Date().toISOString(),
        });

        results.traffic_bulk = {
          google: gItem?.metrics || null,
          bing: bItem?.metrics || null,
        };
      } catch (err) {
        errors.push(`Traffic (bulk): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // DataForSEO Traffic Detailed (Domain Rank Overview - includes spend estimates + ranking distribution)
  if (source === "traffic_detailed") {
    if (!installer.website) {
      results.traffic_detailed = { message: "No website URL" };
    } else {
      try {
        const login = process.env.DATAFORSEO_LOGIN;
        const password = process.env.DATAFORSEO_PASSWORD;
        if (!login || !password) throw new Error("DATAFORSEO credentials not set");

        const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
        const domain = installer.website.startsWith("http")
          ? new URL(installer.website).hostname.replace(/^www\./, "")
          : installer.website.replace(/^www\./, "");

        const res = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live", {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify([{
            target: domain,
            location_name: "United Kingdom",
            language_name: "English",
          }]),
        });

        const data = await res.json();
        const items = data?.tasks?.[0]?.result?.[0]?.items;

        if (items?.length > 0) {
          const item = items[0];
          const org = item.metrics?.organic || {};
          const paid = item.metrics?.paid || {};

          await db.delete(trafficData).where(eq(trafficData.installerId, installerId));

          await db.insert(trafficData).values({
            installerId,
            googleOrganicEtv: org.etv ?? null,
            googleOrganicCount: org.count ?? null,
            googleOrganicTrafficCost: org.estimated_paid_traffic_cost ?? null,
            googlePaidEtv: paid.etv ?? null,
            googlePaidCount: paid.count ?? null,
            googlePaidTrafficCost: paid.estimated_paid_traffic_cost ?? null,
            googleFeaturedSnippetEtv: item.metrics?.featured_snippet?.etv ?? null,
            googleLocalPackEtv: item.metrics?.local_pack?.etv ?? null,
            googleOrganicPos1: org.pos_1 ?? null,
            googleOrganicPos2_3: (org.pos_2_3 ?? null),
            googleOrganicPos4_10: (org.pos_4_10 ?? null),
            googleOrganicPos11_20: (org.pos_11_20 ?? null),
            googleOrganicIsNew: org.is_new ?? null,
            googleOrganicIsUp: org.is_up ?? null,
            googleOrganicIsDown: org.is_down ?? null,
            googleOrganicIsLost: org.is_lost ?? null,
            googlePaidPos1: paid.pos_1 ?? null,
            googlePaidPos2_3: paid.pos_2_3 ?? null,
            googlePaidPos4_10: paid.pos_4_10 ?? null,
            bingOrganicEtv: null,
            bingOrganicCount: null,
            bingPaidEtv: null,
            bingPaidCount: null,
            source: "detailed",
            fetchedAt: new Date().toISOString(),
          });

          results.traffic_detailed = { organic: org, paid };
        } else {
          results.traffic_detailed = { message: "No ranking data found" };
        }
      } catch (err) {
        errors.push(`Traffic (detailed): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // DataForSEO Keywords for Site
  if (source === "all" || source === "keywords") {
    if (!installer.website) {
      results.keywords = { message: "No website URL" };
    } else {
      try {
        const login = process.env.DATAFORSEO_LOGIN;
        const password = process.env.DATAFORSEO_PASSWORD;
        if (!login || !password) throw new Error("DATAFORSEO credentials not set");

        const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
        const domain = installer.website.startsWith("http")
          ? new URL(installer.website).hostname.replace(/^www\./, "")
          : installer.website.replace(/^www\./, "");

        const res = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live", {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify([{
            target: domain,
            target_type: "site",
            location_name: "United Kingdom",
            language_name: "English",
            sort_by: "search_volume",
          }]),
        });

        const data = await res.json();
        const items = data?.tasks?.[0]?.result;

        if (items?.length > 0) {
          // Delete old keyword data
          await db.delete(keywordData).where(eq(keywordData.installerId, installerId));

          const keywords = items.map(
            (item: {
              keyword: string;
              search_volume?: number;
              cpc?: number;
              competition?: string;
              competition_index?: number;
              low_top_of_page_bid?: number;
              high_top_of_page_bid?: number;
              monthly_searches?: unknown[];
            }) => ({
              installerId,
              keyword: item.keyword,
              searchVolume: item.search_volume ?? null,
              cpc: item.cpc ?? null,
              competition: item.competition ?? null,
              competitionIndex: item.competition_index ?? null,
              lowTopOfPageBid: item.low_top_of_page_bid ?? null,
              highTopOfPageBid: item.high_top_of_page_bid ?? null,
              monthlySearches: item.monthly_searches ? JSON.stringify(item.monthly_searches) : null,
              fetchedAt: new Date().toISOString(),
            })
          );

          // Insert in batches
          for (let i = 0; i < keywords.length; i += 100) {
            await db.insert(keywordData).values(keywords.slice(i, i + 100));
          }

          results.keywords = { count: keywords.length };
        } else {
          results.keywords = { message: "No keyword data found" };
        }
      } catch (err) {
        errors.push(`Keywords: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Google Business Info
  if (source === "all" || source === "google_business") {
    try {
      const { fetchGoogleBusinessInfo } = await import("@/lib/enrichment/google-business");
      const { result, error } = await fetchGoogleBusinessInfo(installerId);
      if (error) {
        errors.push(`Google Business: ${error}`);
      } else {
        results.google_business = {
          title: (result as Record<string, unknown>)?.title,
          phone: (result as Record<string, unknown>)?.phone,
          website: (result as Record<string, unknown>)?.domain,
          category: (result as Record<string, unknown>)?.category,
          claimed: (result as Record<string, unknown>)?.is_claimed,
        };
      }
    } catch (err) {
      errors.push(`Google Business: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Google Ads Transparency
  if (source === "all" || source === "google_ads") {
    try {
      const { fetchGoogleAdsTransparency } = await import("@/lib/enrichment/google-ads-transparency");
      const { result, error } = await fetchGoogleAdsTransparency(installerId);
      if (error) {
        errors.push(`Google Ads: ${error}`);
      } else {
        results.google_ads = result;
      }
    } catch (err) {
      errors.push(`Google Ads: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Job Postings
  if (source === "all" || source === "job_postings") {
    try {
      const { fetchJobPostings } = await import("@/lib/enrichment/job-postings");
      const { result, error } = await fetchJobPostings(installerId);
      if (error) {
        errors.push(`Job Postings: ${error}`);
      } else {
        results.job_postings = result;
      }
    } catch (err) {
      errors.push(`Job Postings: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ results, errors });
}
