import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const dfsLogin = Deno.env.get("DATAFORSEO_LOGIN")!;
  const dfsPassword = Deno.env.get("DATAFORSEO_PASSWORD")!;

  const supabase = createClient(supabaseUrl, supabaseKey);
  const dfsAuth = "Basic " + btoa(`${dfsLogin}:${dfsPassword}`);

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const limit = body.limit || 200;

  // Directories/aggregators to skip — must be actual company websites
  const skipDomains = new Set([
    // Social & search
    "facebook.com", "linkedin.com", "twitter.com", "instagram.com",
    "youtube.com", "tiktok.com", "google.com", "google.co.uk",
    "bing.com", "yahoo.com", "wikipedia.org", "pinterest.com",
    // Marketplaces
    "amazon.co.uk", "amazon.com", "ebay.co.uk", "gumtree.com",
    // Reviews & ratings
    "trustpilot.com", "yelp.com", "yelp.co.uk", "glassdoor.co.uk",
    // Trade directories
    "yell.com", "checkatrade.com", "mybuilder.com", "bark.com",
    "ratedpeople.com", "freeindex.co.uk", "hotfrog.co.uk",
    "scoot.co.uk", "cylex-uk.co.uk", "thomsonlocal.com",
    "brownbook.net", "applegate.co.uk", "thebestof.co.uk", "192.com",
    "which.co.uk", "homeadvisor.com", "rated.people.com",
    // MCS / certification / industry directories
    "mcscertified.com", "mcsinstallers.com", "trustmark.org.uk",
    "findcertifiedinstallers.co.uk", "solarinfo.uk", "search.napit.org.uk",
    "napit.org.uk", "installerfinder.energysavingtrust.org.uk",
    "energysavingtrust.org.uk", "renewablesexcellence.co.uk",
    "renewableenergyhub.co.uk", "solarguide.co.uk", "greenmatch.co.uk",
    "theecoexperts.co.uk", "solarpanelcompare.co.uk",
    "enf.com.cn", "enfsolar.com", "fleetsmart.co.uk",
    "solarreviews.com", "solarpanelinstallation.co.uk",
    // Construction / business directories
    "construction.co.uk", "ukconstructionmedia.co.uk",
    // Companies House / business registries
    "companieshouse.gov.uk", "endole.co.uk", "dnb.com", "gov.uk",
    "find-and-update.company-information.service.gov.uk",
    // Job boards
    "indeed.co.uk", "reed.co.uk", "totaljobs.com", "glassdoor.com",
    "cv-library.co.uk",
    // More directories found in testing
    "solarinstallerlist.com", "ukhomeenergy.co.uk", "solar-panels-leeds.uk",
    "solar-panels-uk.co.uk", "fixatrader.com", "hamuch.com",
    "recc.org.uk", "bebee.com", "sustainablebusinessmagazine.net",
    "yfs.co.uk", "forgedrenewables.co.uk", "uk.linkedin.com",
  ]);

  // Also skip any domain that contains these patterns (partial match)
  const skipPatterns = [
    "directory", "finder", "find-a-", "lookup", "search.",
    "listof", "listings", "yellowpages",
  ];

  // Get installers without websites
  let allInstallers: { id: number; company_name: string; postcode: string | null; county: string | null }[] = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from("installers")
      .select("id, company_name, postcode, county")
      .or("website.is.null,website.eq.")
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allInstallers = allInstallers.concat(data);
    if (data.length < 1000) break;
    page++;
  }

  const toProcess = allInstallers.slice(0, limit);

  if (toProcess.length === 0) {
    return new Response(JSON.stringify({ message: "All installers have websites", found: 0, remaining: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let found = 0;
  let notFound = 0;
  let errors = 0;
  const results: { id: number; name: string; website: string; source: string }[] = [];

  // Process in parallel batches of 10
  for (let i = 0; i < toProcess.length; i += 10) {
    const batch = toProcess.slice(i, i + 10);

    await Promise.allSettled(batch.map(async (inst) => {
      try {
        // Search Google for the company name
        const searchQuery = `"${inst.company_name}" solar installer UK`;
        const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
          method: "POST",
          headers: { Authorization: dfsAuth, "Content-Type": "application/json" },
          body: JSON.stringify([{
            keyword: searchQuery,
            location_name: "United Kingdom",
            language_name: "English",
            depth: 10,
          }]),
        });

        const data = await res.json();
        const task = data?.tasks?.[0];

        if (!task?.result?.[0]?.items) {
          notFound++;
          return;
        }

        const items = task.result[0].items.filter(
          (item: { type?: string }) => item.type === "organic"
        );

        // Find first result that's a likely company website
        let bestUrl: string | null = null;
        let bestTitle = "";

        // Extract meaningful words from company name for matching
        const genericWords = new Set(["solar", "energy", "electrical", "electric", "electrics", "green", "power", "eco", "renewables", "renewable", "heating", "plumbing", "services", "solutions", "group", "home", "homes", "install", "installer", "installation", "installations", "systems", "contracting", "contractors", "consulting", "consultants", "division"]);
        const nameWords = inst.company_name
          .toLowerCase()
          .replace(/\b(ltd|limited|llp|plc|inc|t\/a|trading as|the|and|of|uk)\b/g, "")
          .replace(/[^a-z0-9\s]/g, "")
          .split(/\s+/)
          .filter((w: string) => w.length > 2 && !genericWords.has(w));

        for (const item of items) {
          if (!item.domain) continue;
          const domain = item.domain.replace(/^www\./, "").toLowerCase();
          if (skipDomains.has(domain)) continue;
          if (skipPatterns.some((p: string) => domain.includes(p))) continue;

          // Domain must contain at least one significant word from the company name
          const domainBase = domain.split(".")[0]; // e.g. "a1groupedinburgh" from "a1groupedinburgh.co.uk"
          const hasNameMatch = nameWords.some((w: string) => domainBase.includes(w));
          if (!hasNameMatch) continue;

          bestUrl = item.url;
          bestTitle = item.title || "";
          break;
        }

        if (bestUrl) {
          // Extract clean domain
          try {
            const url = new URL(bestUrl);
            const cleanUrl = `${url.protocol}//${url.hostname}`;

            if (!dryRun) {
              await supabase.from("installers").update({
                website: cleanUrl,
                website_status: "found",
              }).eq("id", inst.id);
            }

            found++;
            results.push({
              id: inst.id,
              name: inst.company_name,
              website: cleanUrl,
              source: bestTitle,
            });
          } catch {
            notFound++;
          }
        } else {
          notFound++;
          if (!dryRun) {
            await supabase.from("installers").update({
              website_status: "not_found",
            }).eq("id", inst.id);
          }
        }
      } catch {
        errors++;
      }
    }));
  }

  return new Response(JSON.stringify({
    dryRun,
    total: allInstallers.length,
    processed: toProcess.length,
    found,
    notFound,
    errors,
    remaining: allInstallers.length - toProcess.length,
    examples: results.slice(0, 30),
    message: dryRun
      ? `DRY RUN: Found websites for ${found} of ${toProcess.length}. Set dryRun: false to apply.`
      : `Found websites for ${found} of ${toProcess.length}. ${allInstallers.length - toProcess.length} remaining.`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
