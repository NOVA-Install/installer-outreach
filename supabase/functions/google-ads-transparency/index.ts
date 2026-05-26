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

  // Parse options
  const body = await req.json().catch(() => ({}));
  const minTraffic = body.minTraffic || 0;

  // Get eligible installers (paginated)
  let allInstallers: { id: number; website: string }[] = [];
  let pg = 0;
  while (true) {
    const { data } = await supabase
      .from("installers")
      .select("id, website")
      .not("website", "is", null)
      .neq("website", "")
      .range(pg * 1000, (pg + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allInstallers = allInstallers.concat(data);
    if (data.length < 1000) break;
    pg++;
  }

  // Get existing google_ads_data
  const existingIds = new Set<number>();
  pg = 0;
  while (true) {
    const { data } = await supabase
      .from("google_ads_data")
      .select("installer_id")
      .range(pg * 1000, (pg + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach((e: { installer_id: number }) => existingIds.add(e.installer_id));
    if (data.length < 1000) break;
    pg++;
  }

  let toEnrich = allInstallers.filter((i) => !existingIds.has(i.id));

  // Apply traffic filter if set
  if (minTraffic > 0) {
    const trafficIds = new Map<number, number>();
    pg = 0;
    while (true) {
      const { data } = await supabase
        .from("traffic_data")
        .select("installer_id, google_organic_etv")
        .range(pg * 1000, (pg + 1) * 1000 - 1);
      if (!data || data.length === 0) break;
      data.forEach((e: { installer_id: number; google_organic_etv: number | null }) => {
        if (e.google_organic_etv != null) trafficIds.set(e.installer_id, e.google_organic_etv);
      });
      if (data.length < 1000) break;
      pg++;
    }
    toEnrich = toEnrich.filter((i) => (trafficIds.get(i.id) || 0) >= minTraffic);
  }

  const remaining = toEnrich.length;

  if (remaining === 0) {
    return new Response(JSON.stringify({ message: "No installers to process", processed: 0, remaining: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Process max 150 per invocation (30 parallel × 5 batches within timeout)
  const toProcess = toEnrich.slice(0, 150);

  // Only create job record if not called from Inngest
  const skipJob = body.skipJob === true;
  let job: { id: number } | null = null;
  if (!skipJob) {
    const { data } = await supabase.from("enrichment_jobs").insert({
      type: "google_ads_transparency",
      status: "running",
      total_items: toProcess.length,
      processed_items: 0,
      error_count: 0,
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).select("id").single();
    job = data;
  }

  let processed = 0;
  let errors = 0;

  // Process in parallel batches of 30
  for (let i = 0; i < toProcess.length; i += 30) {
    const batch = toProcess.slice(i, i + 30);

    await Promise.allSettled(
      batch.map(async (inst) => {
        try {
          const raw = inst.website as string;
          const rawUrl = raw.startsWith("http") ? raw : `https://${raw}`;
          const domain = new URL(rawUrl).hostname.replace(/^www\./, "");

          const res = await fetch("https://api.dataforseo.com/v3/serp/google/ads_search/live/advanced", {
            method: "POST",
            headers: { Authorization: dfsAuth, "Content-Type": "application/json" },
            body: JSON.stringify([{
              target: domain,
              location_name: "United Kingdom",
              language_name: "English",
              depth: 20,
            }]),
          });

          const data = await res.json();
          const task = data?.tasks?.[0];

          // 40102 = no ads (valid result)
          if (task?.status_code !== 20000 && task?.status_code !== 40102) {
            throw new Error(`${task?.status_code}: ${task?.status_message}`);
          }

          const items = task?.result?.[0]?.items || [];
          let textAds = 0, imageAds = 0, videoAds = 0;
          const platforms = new Set<string>();
          let firstSeen: string | null = null;
          let lastSeen: string | null = null;
          const sampleTitles: string[] = [];
          const creativeIds: string[] = [];
          const transparencyUrls: string[] = [];
          const previewImageUrls: string[] = [];
          let advId: string | null = null;
          let advName: string | null = null;
          let verified = false;

          for (const item of items) {
            if (item.format === "text") textAds++;
            else if (item.format === "image") imageAds++;
            else if (item.format === "video") videoAds++;
            if (item.platform) platforms.add(item.platform);
            if (item.first_shown && (!firstSeen || item.first_shown < firstSeen)) firstSeen = item.first_shown;
            if (item.last_shown && (!lastSeen || item.last_shown > lastSeen)) lastSeen = item.last_shown;
            if (sampleTitles.length < 5 && item.title) sampleTitles.push(item.title);
            if (item.creative_id) creativeIds.push(item.creative_id);
            if (item.url) transparencyUrls.push(item.url);
            const previewImg = item.preview_image?.[0];
            if (previewImg?.url) previewImageUrls.push(previewImg.url);
            if (item.advertiser_id && !advId) {
              advId = item.advertiser_id;
              advName = item.title || null;
              verified = item.verified || false;
            }
          }

          await supabase.from("google_ads_data").upsert({
            installer_id: inst.id,
            advertiser_id: advId,
            advertiser_name: advName,
            is_verified: verified,
            total_ads: items.length,
            text_ads: textAds,
            image_ads: imageAds,
            video_ads: videoAds,
            platforms: platforms.size > 0 ? JSON.stringify(Array.from(platforms)) : null,
            first_ad_seen: firstSeen,
            last_ad_seen: lastSeen,
            sample_ad_titles: sampleTitles.length > 0 ? JSON.stringify(sampleTitles) : null,
            creative_ids: creativeIds.length > 0 ? JSON.stringify(creativeIds) : null,
            transparency_urls: transparencyUrls.length > 0 ? JSON.stringify(transparencyUrls) : null,
            preview_image_urls: previewImageUrls.length > 0 ? JSON.stringify(previewImageUrls) : null,
            fetched_at: new Date().toISOString(),
          }, { onConflict: "installer_id" });

          processed++;
        } catch (err) {
          console.error(`Google Ads enrichment failed for installer ${inst.id}:`, err instanceof Error ? err.message : err);
          errors++;
        }
      })
    );

    // Update progress
    if (job?.id) {
      await supabase.from("enrichment_jobs").update({
        processed_items: processed,
        error_count: errors,
      }).eq("id", job.id);
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
    remaining: remaining - processed,
    message: `Google Ads: ${processed} processed, ${remaining - processed} remaining`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
