import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CH_BASE = "https://api.company-information.service.gov.uk";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const chApiKey = Deno.env.get("COMPANIES_HOUSE_API_KEY")!;
  const googleAiKey = Deno.env.get("GOOGLE_AI_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey);
  const chAuth = "Basic " + btoa(`${chApiKey}:`);

  async function chGet(path: string) {
    const res = await fetch(`${CH_BASE}${path}`, { headers: { Authorization: chAuth } });
    if (!res.ok) {
      if (res.status === 404) return null;
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000)); return null; }
      throw new Error(`CH API error: ${res.status}`);
    }
    return res.json();
  }

  // Find installers without companies house data
  // Paginate to get all installers
  let allInstallers: { id: number; company_name: string; postcode: string | null }[] = [];
  let pg = 0;
  while (true) {
    const { data } = await supabase
      .from("installers")
      .select("id, company_name, postcode")
      .order("id")
      .range(pg * 1000, (pg + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allInstallers = allInstallers.concat(data);
    if (data.length < 1000) break;
    pg++;
  }

  // Paginate existing
  const existingIds = new Set<number>();
  pg = 0;
  while (true) {
    const { data } = await supabase
      .from("companies_house_data")
      .select("installer_id")
      .range(pg * 1000, (pg + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach((e: { installer_id: number }) => existingIds.add(e.installer_id));
    if (data.length < 1000) break;
    pg++;
  }

  const allToEnrich = allInstallers.filter((i) => !existingIds.has(i.id));
  const remaining = allToEnrich.length;

  if (remaining === 0) {
    return new Response(JSON.stringify({ message: "All installers already have Companies House data", processed: 0, remaining: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Process 1 per invocation — Inngest handles looping
  const toEnrich = allToEnrich.slice(0, 1);

  // Only create job record if not called from Inngest
  const body = await req.json().catch(() => ({}));
  const skipJob = body.skipJob === true;
  let job: { id: number } | null = null;
  if (!skipJob) {
    const { data } = await supabase.from("enrichment_jobs").insert({
      type: "companies_house",
      status: "running",
      total_items: toEnrich.length,
      processed_items: 0,
      error_count: 0,
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).select("id").single();
    job = data;
  }

  let processed = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Process 1 at a time to stay within rate limit (600/5min = 2/sec, each installer makes ~5 calls)
  for (let i = 0; i < toEnrich.length; i += 1) {
    const batch = toEnrich.slice(i, i + 1);

    await Promise.allSettled(batch.map(async (installer: { id: number; company_name: string; postcode: string | null }) => {
      try {
        // Search
        const searchResult = await chGet(
          `/search/companies?q=${encodeURIComponent(installer.company_name)}&items_per_page=5`
        );

        if (!searchResult?.items?.length) return;

        // Normalize for comparison
        function norm(s: string) {
          return s.toLowerCase().replace(/\b(ltd|limited|llp|plc|inc|t\/a|trading as)\b/g, "").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, " ");
        }

        // Pre-filter: only consider results where the name has meaningful overlap
        const instNorm = norm(installer.company_name);
        const instWords = instNorm.split(" ").filter((w: string) => w.length > 2);
        const genericWords = new Set(["energy", "solar", "electrical", "electric", "green", "power", "heating", "plumbing", "services", "solutions", "renewables", "renewable", "installations", "contractors", "group", "homes"]);
        const meaningfulWords = instWords.filter((w: string) => !genericWords.has(w));

        // Find best match — require at least 1 meaningful word in common
        let bestMatch: typeof searchResult.items[0] | null = null;
        for (const item of searchResult.items) {
          const itemNorm = norm(item.title || "");
          // Exact match after normalization
          if (instNorm === itemNorm) { bestMatch = item; break; }
          // Check meaningful word overlap
          const itemWords = itemNorm.split(" ").filter((w: string) => w.length > 2);
          const commonMeaningful = meaningfulWords.filter((w: string) => itemWords.includes(w));
          if (commonMeaningful.length >= 1) {
            bestMatch = item;
            break;
          }
        }

        // If no meaningful match found without AI, skip
        if (!bestMatch && !googleAiKey) return;

        // Use AI for matching (or strict name check if no AI)
        if (googleAiKey) {
          try {
            const candidates = searchResult.items.map((item: { title: string; company_number: string; company_status: string; address?: { postal_code?: string; address_line_1?: string; locality?: string } }, idx: number) =>
              `[${idx}] "${item.title}" (${item.company_number}) - ${item.company_status} - ${item.address?.address_line_1 || ""} ${item.address?.postal_code || ""}`
            ).join("\n");

            const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleAiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `I need to match the solar installer "${installer.company_name}" (postcode: ${installer.postcode || "unknown"}) to its Companies House registration.

Here are the search results:
${candidates}

IMPORTANT RULES:
- The company name must be essentially the SAME business, not just share common words like "electrical", "solar", "renewable", "heating", "energy", "green", "power"
- "EcoGlow Heating" is NOT the same as "AA Plumbing and Heating" — they share "heating" but are different companies
- Sole traders or trading names (e.g. "John Smith T/A Solar Direct") should match "SOLAR DIRECT LTD" but NOT "JOHN SMITH BUILDERS LTD"
- If the postcode is known, prefer matches in the same area, but don't match a completely different company just because the postcode matches
- If NONE of the results are the same company, reply "NONE" — it's better to have no match than a wrong match

Reply with ONLY the index number (0-${searchResult.items.length - 1}), or "NONE".` }] }],
              }),
            });
            const aiData = await aiRes.json();
            const answer = aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
            const idx = parseInt(answer);
            if (!isNaN(idx) && idx >= 0 && idx < searchResult.items.length) {
              bestMatch = searchResult.items[idx];
            } else if (answer.toUpperCase().includes("NONE")) {
              return; // AI says no match
            }
          } catch {
            // AI failed — only use fallback if name is very close
          }
        }

        const companyNumber = bestMatch.company_number;

        // Fetch all details in parallel
        const [profile, officersData, pscData, filingData] = await Promise.all([
          chGet(`/company/${companyNumber}`),
          chGet(`/company/${companyNumber}/officers?items_per_page=50`),
          chGet(`/company/${companyNumber}/persons-with-significant-control`),
          chGet(`/company/${companyNumber}/filing-history?items_per_page=10&category=accounts`),
        ]);

        if (!profile) return;

        const officers = (officersData?.items || []).map(
          (o: { name: string; officer_role: string; appointed_on?: string; resigned_on?: string }) => ({
            name: o.name, role: o.officer_role, appointedOn: o.appointed_on || null, resignedOn: o.resigned_on || null,
          })
        );

        const psc = (pscData?.items || []).map(
          (p: { name?: string; natures_of_control?: string[] }) => ({
            name: p.name, naturesOfControl: p.natures_of_control || [],
          })
        );

        let latestAccountsUrl: string | null = null;
        let latestAccountsType: string | null = null;
        if (filingData?.items?.length > 0) {
          latestAccountsType = filingData.items[0].description || null;
          latestAccountsUrl = `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history`;
        }

        await supabase.from("companies_house_data").upsert({
          installer_id: installer.id,
          company_number: profile.company_number,
          company_status: profile.company_status,
          incorporation_date: profile.date_of_creation,
          company_type: profile.type,
          sic_codes: profile.sic_codes ? JSON.stringify(profile.sic_codes) : null,
          registered_address: profile.registered_office_address
            ? [
                profile.registered_office_address.address_line_1,
                profile.registered_office_address.address_line_2,
                profile.registered_office_address.locality,
                profile.registered_office_address.postal_code,
              ].filter(Boolean).join(", ")
            : null,
          last_accounts_date: profile.accounts?.last_accounts?.made_up_to || null,
          account_category: profile.accounts?.last_accounts?.type || null,
          employee_count: null,
          officers: officers.length > 0 ? JSON.stringify(officers) : null,
          persons_of_control: psc.length > 0 ? JSON.stringify(psc) : null,
          latest_accounts_url: latestAccountsUrl,
          latest_accounts_type: latestAccountsType,
          has_insolvency_history: profile.has_insolvency_history ?? false,
          has_charges: false,
          charges_count: 0,
          fetched_at: new Date().toISOString(),
        }, { onConflict: "installer_id" });

        // Also update legal entity name on installer
        await supabase.from("installers").update({
          legal_entity_name: profile.company_name || bestMatch.title,
          legal_entity_number: companyNumber,
          updated_at: new Date().toISOString(),
        }).eq("id", installer.id);

      } catch (err) {
        errors++;
        const msg = `${installer.company_name} (id ${installer.id}): ${err instanceof Error ? err.message : String(err)}`;
        console.error(`CH enrichment failed:`, msg);
        if (errorLog.length < 50) errorLog.push(msg);
      }
    }));

    processed += batch.length;
  }

  // Mark complete
  if (job?.id) {
    await supabase.from("enrichment_jobs").update({
      processed_items: processed,
      error_count: errors,
      error_log: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  return new Response(JSON.stringify({
    processed,
    errors,
    total: toEnrich.length,
    remaining: remaining - processed,
    message: `Companies House: ${processed} processed, ${remaining - processed} remaining`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
