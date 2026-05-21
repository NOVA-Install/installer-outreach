import { NextRequest, NextResponse } from "next/server";

// Step 3: Lookup missing data (Companies House for registered name, website)
export async function POST(request: NextRequest) {
  const { companyName, postcode } = await request.json();

  if (!companyName) {
    return NextResponse.json({ error: "Company name required" }, { status: 400 });
  }

  const results: {
    companiesHouse: {
      companyName: string;
      companyNumber: string;
      address: string;
      status: string;
    } | null;
    possibleWebsites: string[];
  } = {
    companiesHouse: null,
    possibleWebsites: [],
  };

  // Companies House lookup for registered name
  const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (chApiKey) {
    try {
      const auth = "Basic " + Buffer.from(`${chApiKey}:`).toString("base64");
      const searchRes = await fetch(
        `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`,
        { headers: { Authorization: auth } }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.items?.length > 0) {
          // If postcode provided, prefer match by postcode
          let bestMatch = searchData.items[0];
          if (postcode) {
            const prefix = postcode.split(" ")[0].toUpperCase();
            const byPostcode = searchData.items.find(
              (item: { address?: { postal_code?: string } }) =>
                item.address?.postal_code?.toUpperCase().startsWith(prefix)
            );
            if (byPostcode) bestMatch = byPostcode;
          }

          results.companiesHouse = {
            companyName: bestMatch.title,
            companyNumber: bestMatch.company_number,
            address: [
              bestMatch.address?.address_line_1,
              bestMatch.address?.locality,
              bestMatch.address?.postal_code,
            ]
              .filter(Boolean)
              .join(", "),
            status: bestMatch.company_status || "unknown",
          };
        }
      }
    } catch {
      // Companies House lookup failed, continue
    }
  }

  // DataForSEO SERP search for website
  const dfsLogin = process.env.DATAFORSEO_LOGIN;
  const dfsPassword = process.env.DATAFORSEO_PASSWORD;
  if (dfsLogin && dfsPassword) {
    try {
      const auth = "Basic " + Buffer.from(`${dfsLogin}:${dfsPassword}`).toString("base64");
      const searchQuery = `${companyName} ${postcode || ""} solar installer`.trim();

      const res = await fetch(
        "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
        {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify([
            {
              keyword: searchQuery,
              location_name: "United Kingdom",
              language_name: "English",
              depth: 5,
            },
          ]),
        }
      );

      const data = await res.json();
      const items = data?.tasks?.[0]?.result?.[0]?.items;

      if (items?.length > 0) {
        const domains = new Set<string>();
        for (const item of items) {
          if (item.type === "organic" && item.domain) {
            // Skip generic domains
            const skip = [
              "trustpilot.com", "facebook.com", "twitter.com", "linkedin.com",
              "instagram.com", "yell.com", "checkatrade.com", "google.com",
              "yelp.com", "which.co.uk", "youtube.com", "gov.uk",
              "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk",
            ];
            if (!skip.some((s) => item.domain.includes(s))) {
              domains.add(item.domain);
            }
          }
        }
        results.possibleWebsites = Array.from(domains).slice(0, 5);
      }
    } catch {
      // SERP lookup failed, continue
    }
  }

  return NextResponse.json(results);
}
