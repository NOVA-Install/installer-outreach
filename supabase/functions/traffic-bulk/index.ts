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

  // Get installers with website but no traffic data
  // Supabase default limit is 1000, need to paginate
  let allInstallers: { id: number; website: string }[] = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from("installers")
      .select("id, website")
      .not("website", "is", null)
      .neq("website", "")
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allInstallers = allInstallers.concat(data);
    if (data.length < 1000) break;
    page++;
  }

  // Skip installers that have real traffic data (not null-only rows from previous failed batches)
  let existingTrafficIds: number[] = [];
  page = 0;
  while (true) {
    const { data } = await supabase
      .from("traffic_data")
      .select("installer_id, google_organic_etv, google_paid_etv, bing_organic_etv")
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.google_organic_etv != null || row.google_paid_etv != null || row.bing_organic_etv != null) {
        existingTrafficIds.push(row.installer_id);
      }
    }
    if (data.length < 1000) break;
    page++;
  }

  const existingIds = new Set(existingTrafficIds);
  const toEnrich = allInstallers.filter((i: { id: number }) => !existingIds.has(i.id));
  const remaining = toEnrich.length;

  if (remaining === 0) {
    return new Response(JSON.stringify({ message: "All installers already have traffic data", processed: 0, remaining: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Process max 2000 per invocation to stay within timeout
  const toProcess = toEnrich.slice(0, 2000);

  // Create job
  const { data: job } = await supabase.from("enrichment_jobs").insert({
    type: "traffic_bulk",
    status: "running",
    total_items: toProcess.length,
    processed_items: 0,
    error_count: 0,
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }).select("id").single();

  // Extract domains - map both with and without www
  const domainMap = new Map<string, number>(); // domain → installerId
  const allDomains: string[] = [];

  for (const inst of toProcess) {
    if (!inst.website) continue;
    try {
      let raw = (inst.website as string).trim();
      // Handle pipe-separated multiple websites - take the first one
      if (raw.includes("|")) raw = raw.split("|")[0].trim();
      const hostname = raw.startsWith("http") ? new URL(raw).hostname : raw.split("/")[0];
      const withoutWww = hostname.replace(/^www\./, "").toLowerCase();
      // Skip invalid domains (spaces, no dot, too short)
      if (!withoutWww || withoutWww.length < 3 || !withoutWww.includes(".") || /\s/.test(withoutWww)) continue;
      domainMap.set(withoutWww, inst.id);
      domainMap.set(hostname, inst.id);
      if (!allDomains.includes(withoutWww)) allDomains.push(withoutWww);
    } catch {
      // skip
    }
  }

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  // Use larger API batches (API returns all results), but batch DB writes
  for (let i = 0; i < allDomains.length; i += 100) {
    const batch = allDomains.slice(i, i + 100);

    try {
      // Google + Bing in parallel
      const [googleRes, bingRes] = await Promise.all([
        fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_traffic_estimation/live", {
          method: "POST",
          headers: { Authorization: dfsAuth, "Content-Type": "application/json" },
          body: JSON.stringify([{
            targets: batch,
            location_name: "United Kingdom",
            language_name: "English",
            item_types: ["organic", "paid", "featured_snippet", "local_pack"],
          }]),
        }),
        fetch("https://api.dataforseo.com/v3/dataforseo_labs/bing/bulk_traffic_estimation/live", {
          method: "POST",
          headers: { Authorization: dfsAuth, "Content-Type": "application/json" },
          body: JSON.stringify([{
            targets: batch,
            location_name: "United Kingdom",
            language_name: "English",
            item_types: ["organic", "paid"],
          }]),
        }),
      ]);

      const googleData = await googleRes.json();
      const bingData = await bingRes.json();

      // Index results by domain
      const googleByTarget = new Map<string, Record<string, unknown>>();
      for (const item of (googleData?.tasks?.[0]?.result?.[0]?.items || [])) {
        if (item.target) googleByTarget.set(item.target, item);
      }

      const bingByTarget = new Map<string, Record<string, unknown>>();
      for (const item of (bingData?.tasks?.[0]?.result?.[0]?.items || [])) {
        if (item.target) bingByTarget.set(item.target, item);
      }

      // Collect all rows for batch upsert
      const toInsert: Record<string, unknown>[] = [];
      const processedIds = new Set<number>();

      for (const domain of batch) {
        const instId = domainMap.get(domain);
        if (!instId || processedIds.has(instId)) continue;
        processedIds.add(instId);

        const gItem = googleByTarget.get(domain);
        const bItem = bingByTarget.get(domain);

        if (!gItem && !bItem) {
          skipped++;
          toInsert.push({
            installer_id: instId,
            source: "bulk_no_data",
            fetched_at: new Date().toISOString(),
          });
          continue;
        }

        const gMetrics = (gItem?.metrics || {}) as Record<string, { etv?: number; count?: number }>;
        const bMetrics = (bItem?.metrics || {}) as Record<string, { etv?: number; count?: number }>;

        toInsert.push({
          installer_id: instId,
          google_organic_etv: gMetrics.organic?.etv ?? null,
          google_organic_count: gMetrics.organic?.count ?? null,
          google_organic_traffic_cost: null,
          google_paid_etv: gMetrics.paid?.etv ?? null,
          google_paid_count: gMetrics.paid?.count ?? null,
          google_paid_traffic_cost: null,
          google_featured_snippet_etv: gMetrics.featured_snippet?.etv ?? null,
          google_local_pack_etv: gMetrics.local_pack?.etv ?? null,
          bing_organic_etv: bMetrics.organic?.etv ?? null,
          bing_organic_count: bMetrics.organic?.count ?? null,
          bing_paid_etv: bMetrics.paid?.etv ?? null,
          bing_paid_count: bMetrics.paid?.count ?? null,
          source: "bulk",
          fetched_at: new Date().toISOString(),
        });

        processed++;
      }

      // Upsert: insert or update on installer_id conflict
      if (toInsert.length > 0) {
        await supabase.from("traffic_data").upsert(toInsert, { onConflict: "installer_id" });
      }

      // Update progress after each batch
      if (job?.id) {
        await supabase.from("enrichment_jobs").update({
          processed_items: processed,
          error_count: errors,
        }).eq("id", job.id);
      }

    } catch (err) {
      console.error(`Traffic batch ${i}-${i+100} failed:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  // Mark complete
  if (job?.id) {
    await supabase.from("enrichment_jobs").update({
      processed_items: processed,
      error_count: errors,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  return new Response(JSON.stringify({
    processed,
    errors,
    skipped,
    total: allDomains.length,
    remaining: remaining - processed - skipped,
    message: `Traffic enrichment: ${processed} with data, ${skipped} no data in API, ${remaining - processed - skipped} remaining`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
