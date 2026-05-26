import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TECH_PATTERNS: { name: string; field: string; patterns: string[] }[] = [
  { name: "Google Analytics", field: "ga", patterns: ["gtag(", "google-analytics.com", "googletagmanager.com", "analytics.js", "g-", "ua-"] },
  { name: "Google Ads", field: "gads", patterns: ["aw-", "googleadservices.com", "google_conversion", "conversion.js", "googleads.g.doubleclick.net", "googlesyndication.com", "adservice.google.com", "ads/ga-audiences"] },
  { name: "Microsoft Ads", field: "msads", patterns: ["bat.bing.com", "uetag", "clarity.ms"] },
  { name: "Meta Pixel", field: "meta", patterns: ["fbq(", "connect.facebook.net", "facebook-jssdk", "facebook.com/tr"] },
  { name: "HubSpot", field: "crm", patterns: ["hs-scripts.com", "hubspot.com", "hbspt.forms", "hs-analytics"] },
  { name: "Salesforce", field: "crm", patterns: ["pardot.com", "salesforce.com", "force.com"] },
  { name: "Zoho", field: "crm", patterns: ["zoho.com", "zohocdn.com", "salesiq.zoho"] },
  { name: "Pipedrive", field: "crm", patterns: ["pipedrive.com", "pipedrivewebforms"] },
  { name: "ActiveCampaign", field: "crm", patterns: ["activecampaign.com", "trackcmp.net"] },
  { name: "Tawk.to", field: "chat", patterns: ["tawk.to", "embed.tawk.to"] },
  { name: "Intercom", field: "chat", patterns: ["intercom.io", "intercomcdn.com", "widget.intercom.io"] },
  { name: "Drift", field: "chat", patterns: ["drift.com", "js.driftt.com"] },
  { name: "Crisp", field: "chat", patterns: ["crisp.chat", "client.crisp.chat"] },
  { name: "Zendesk", field: "chat", patterns: ["zdassets.com", "zendesk.com", "zopim.com"] },
  { name: "LiveChat", field: "chat", patterns: ["livechatinc.com", "livechat.com"] },
  { name: "Google Tag Manager", field: "tech", patterns: ["googletagmanager.com/gtm.js", "gtm-"] },
  { name: "Hotjar", field: "tech", patterns: ["hotjar.com", "static.hotjar.com"] },
  { name: "Mailchimp", field: "tech", patterns: ["mailchimp.com", "list-manage.com", "chimpstatic.com"] },
];

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Find installers without marketing signals that have a website
  const { data: toEnrich, error: fetchErr } = await supabase
    .rpc("get_installers_needing_tech_detection")
    .limit(500);

  // Fallback: direct query if RPC doesn't exist
  let installers = toEnrich;
  if (fetchErr) {
    // Paginate to get all installers
    let allData: { id: number; website: string }[] = [];
    let pg = 0;
    while (true) {
      const { data: pageData } = await supabase
        .from("installers")
        .select("id, website")
        .not("website", "is", null)
        .neq("website", "")
        .range(pg * 1000, (pg + 1) * 1000 - 1);
      if (!pageData || pageData.length === 0) break;
      allData = allData.concat(pageData);
      if (pageData.length < 1000) break;
      pg++;
    }

    // Paginate existing marketing_signals
    let existingIds = new Set<number>();
    pg = 0;
    while (true) {
      const { data: exData } = await supabase
        .from("marketing_signals")
        .select("installer_id")
        .range(pg * 1000, (pg + 1) * 1000 - 1);
      if (!exData || exData.length === 0) break;
      exData.forEach((e: { installer_id: number }) => existingIds.add(e.installer_id));
      if (exData.length < 1000) break;
      pg++;
    }

    installers = allData.filter((i: { id: number }) => !existingIds.has(i.id));
  }

  const remaining = installers?.length || 0;
  if (!installers || remaining === 0) {
    return new Response(JSON.stringify({ message: "No installers need tech detection", processed: 0, remaining: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Process 1 per invocation — Inngest handles looping
  const toProcess = installers.slice(0, 1);

  // Only create job record if not called from Inngest (which manages its own tracking)
  const body = await req.json().catch(() => ({}));
  const skipJob = body.skipJob === true;
  let job: { id: number } | null = null;
  if (!skipJob) {
    const { data } = await supabase.from("enrichment_jobs").insert({
      type: "tech_detection",
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

  // Process each installer
  for (let i = 0; i < toProcess.length; i++) {
    const batch = [toProcess[i]].filter((inst: { website: string | null }) => inst.website);

    await Promise.allSettled(
      batch.map(async (inst: { id: number; website: string }) => {
        let raw = inst.website.trim();
        // Clean up bad URLs
        if (raw.includes("|")) raw = raw.split("|")[0].trim();
        if (raw.includes(";")) raw = raw.split(";")[0].trim();
        if (/\s/.test(raw) || raw === "****" || !raw.includes(".")) {
          // Skip obviously invalid URLs, but still mark as processed
          await supabase.from("marketing_signals").upsert({
            installer_id: inst.id,
            has_google_analytics: false, has_google_ads: false, has_meta_pixel: false,
            has_crm_tool: false, has_live_chat: false,
            detected_technologies: JSON.stringify(["error:invalid_url"]),
            fetched_at: new Date().toISOString(),
          }, { onConflict: "installer_id" });
          errors++;
          return;
        }

        const urls = raw.startsWith("http")
          ? [raw, raw.replace("https://", "http://")]
          : [`https://${raw}`, `http://${raw}`];

        let html = "";
        let fetched = false;

        for (const url of urls) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const res = await fetch(url, {
              signal: controller.signal,
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
              redirect: "follow",
            });
            clearTimeout(timeout);
            html = (await res.text()).toLowerCase();
            fetched = true;
            break;
          } catch {
            clearTimeout(timeout);
          }
        }

        const detected: string[] = [];
        let hasGA = false, hasGAds = false, hasMetaPixel = false;
        let hasCrm = false, crmName: string | null = null;
        let hasChat = false, chatName: string | null = null;

        if (fetched && html.length > 0) {
          for (const tech of TECH_PATTERNS) {
            if (tech.patterns.some((p) => html.includes(p.toLowerCase()))) {
              detected.push(tech.name);
              if (tech.field === "ga") hasGA = true;
              if (tech.field === "gads") hasGAds = true;
              if (tech.field === "meta") hasMetaPixel = true;
              if (tech.field === "crm" && !hasCrm) { hasCrm = true; crmName = tech.name; }
              if (tech.field === "chat" && !hasChat) { hasChat = true; chatName = tech.name; }
            }
          }
        } else {
          detected.push("error:fetch_failed");
          errors++;
        }

        // Upsert so this installer doesn't get retried and no race conditions
        await supabase.from("marketing_signals").upsert({
          installer_id: inst.id,
          has_google_analytics: hasGA,
          has_google_ads: hasGAds,
          has_meta_pixel: hasMetaPixel,
          has_crm_tool: hasCrm,
          crm_tool_name: crmName,
          has_live_chat: hasChat,
          live_chat_tool: chatName,
          detected_technologies: JSON.stringify(detected),
          fetched_at: new Date().toISOString(),
        }, { onConflict: "installer_id" });
        processed++;
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

  // Mark job complete
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
    total: installers.length,
    remaining: remaining - processed,
    message: `Tech detection: ${processed} processed, ${remaining - processed} remaining`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
