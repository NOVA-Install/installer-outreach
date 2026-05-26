import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CURRENT_VERSION = 2;

// HTML-based detection patterns
const TECH_PATTERNS: { name: string; field: string; patterns: string[] }[] = [
  // Analytics & Ads
  { name: "Google Analytics", field: "ga", patterns: ["gtag(", "google-analytics.com", "googletagmanager.com", "analytics.js", "ga.js"] },
  { name: "Google Ads", field: "gads", patterns: ["aw-", "googleadservices.com", "google_conversion", "conversion.js", "googleads.g.doubleclick.net", "googlesyndication.com", "adservice.google.com", "ads/ga-audiences"] },
  { name: "Microsoft Ads", field: "tech", patterns: ["bat.bing.com", "uetag", "uet tag", "clarity.ms", "microsoft.com/muid"] },
  { name: "Meta Pixel", field: "meta", patterns: ["fbq(", "connect.facebook.net", "facebook-jssdk", "facebook.com/tr"] },
  // General CRMs
  { name: "HubSpot", field: "crm", patterns: ["hs-scripts.com", "hubspot.com", "hbspt.forms", "hs-analytics"] },
  { name: "Salesforce", field: "crm", patterns: ["pardot.com", "salesforce.com", "force.com"] },
  { name: "Zoho", field: "crm", patterns: ["zoho.com", "zohocdn.com", "salesiq.zoho"] },
  { name: "Pipedrive", field: "crm", patterns: ["pipedrive.com", "pipedrivewebforms"] },
  { name: "ActiveCampaign", field: "crm", patterns: ["activecampaign.com", "trackcmp.net"] },
  { name: "Keap", field: "crm", patterns: ["keap.com", "infusionsoft.com", "keap.app"] },
  { name: "Monday.com", field: "crm", patterns: ["monday.com"] },
  { name: "Freshsales", field: "crm", patterns: ["freshsales.io", "freshworks.com"] },
  // Solar-specific CRMs & tools
  { name: "Simplified Energy", field: "crm", patterns: ["simplifiedenergy.co", "simplified.energy", "simplifiedenergy.com"] },
  { name: "Autarc", field: "crm", patterns: ["autarc.energy"] },
  { name: "Reonic", field: "crm", patterns: ["reonic.de", "reonic.com", "app.reonic"] },
  { name: "SolarEdge", field: "crm", patterns: ["solaredge.com", "monitoring.solaredge.com"] },
  { name: "Enphase", field: "crm", patterns: ["enphase.com", "enlighten.enphaseenergy.com"] },
  { name: "EasySolar", field: "crm", patterns: ["easysolar.com", "easysolar.io"] },
  { name: "Pylon", field: "crm", patterns: ["pylon.energy", "pylon-network.org"] },
  { name: "OpenSolar", field: "crm", patterns: ["opensolar.com", "app.opensolar"] },
  { name: "Sunstak", field: "crm", patterns: ["sunstak.com", "sunstak.co.uk"] },
  { name: "JobNimbus", field: "crm", patterns: ["jobnimbus.com", "app.jobnimbus.com"] },
  { name: "Commusoft", field: "crm", patterns: ["commusoft.co.uk", "commusoft.com"] },
  { name: "SimPRO", field: "crm", patterns: ["simpro.co", "simprogroup.com"] },
  { name: "Tradify", field: "crm", patterns: ["tradifyhq.com", "tradify.com"] },
  // Chat
  { name: "Tawk.to", field: "chat", patterns: ["tawk.to", "embed.tawk.to"] },
  { name: "Intercom", field: "chat", patterns: ["intercom.io", "intercomcdn.com", "widget.intercom.io"] },
  { name: "Drift", field: "chat", patterns: ["drift.com", "js.driftt.com"] },
  { name: "Crisp", field: "chat", patterns: ["crisp.chat", "client.crisp.chat"] },
  { name: "Zendesk", field: "chat", patterns: ["zdassets.com", "zendesk.com", "zopim.com"] },
  { name: "LiveChat", field: "chat", patterns: ["livechatinc.com", "livechat.com"] },
  // Other tech
  { name: "Google Tag Manager", field: "tech", patterns: ["googletagmanager.com/gtm.js", "gtm-"] },
  { name: "Hotjar", field: "tech", patterns: ["hotjar.com", "static.hotjar.com"] },
  { name: "Mailchimp", field: "tech", patterns: ["mailchimp.com", "list-manage.com", "chimpstatic.com"] },
];

// Social media link extraction
const SOCIAL_PATTERNS: { platform: string; key: string; regex: RegExp; exclude: RegExp }[] = [
  { platform: "facebook", key: "facebook_url", regex: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)['"]/gi, exclude: /facebook\.com\/(sharer|share|dialog|plugins|tr|hashtag|flx|watch|groups\/\d|pages\/category|login|help|policies)/i },
  { platform: "instagram", key: "instagram_url", regex: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)['"]/gi, exclude: /instagram\.com\/(explore|accounts|p\/|reel\/|stories\/|about|developer|legal)/i },
  { platform: "linkedin", key: "linkedin_url", regex: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?)['"]/gi, exclude: /linkedin\.com\/(share|sharing|pulse|jobs|learning|feed)/i },
  { platform: "twitter", key: "twitter_url", regex: /href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?)['"]/gi, exclude: /(?:twitter|x)\.com\/(intent|share|hashtag|search|home|i\/|widgets)/i },
  { platform: "youtube", key: "youtube_url", regex: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)[a-zA-Z0-9._-]+\/?)['"]/gi, exclude: /youtube\.com\/(watch|embed|playlist|results|feed|shorts)/i },
];

function extractSocialLinks(html: string): Record<string, string | null> {
  const links: Record<string, string | null> = {
    facebook_url: null, instagram_url: null, linkedin_url: null, twitter_url: null, youtube_url: null,
  };
  for (const { key, regex, exclude } of SOCIAL_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      if (!exclude.test(url)) { links[key] = url; break; }
    }
  }
  return links;
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Find installers needing tech detection:
  // - No marketing_signals record at all, OR
  // - detection_version < CURRENT_VERSION (needs re-scan with new patterns)
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

  // Get IDs that already have current version
  const upToDateIds = new Set<number>();
  pg = 0;
  while (true) {
    const { data: exData } = await supabase
      .from("marketing_signals")
      .select("installer_id")
      .gte("detection_version", CURRENT_VERSION)
      .range(pg * 1000, (pg + 1) * 1000 - 1);
    if (!exData || exData.length === 0) break;
    exData.forEach((e: { installer_id: number }) => upToDateIds.add(e.installer_id));
    if (exData.length < 1000) break;
    pg++;
  }

  const installers = allData.filter((i) => !upToDateIds.has(i.id));
  const remaining = installers.length;

  if (remaining === 0) {
    return new Response(JSON.stringify({ message: "All installers up to date", processed: 0, remaining: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Process 1 per invocation — Inngest handles looping
  const inst = installers[0];

  const body = await req.json().catch(() => ({}));
  const skipJob = body.skipJob === true;
  let job: { id: number } | null = null;
  if (!skipJob) {
    const { data } = await supabase.from("enrichment_jobs").insert({
      type: "tech_detection", status: "running", total_items: 1, processed_items: 0,
      error_count: 0, started_at: new Date().toISOString(), created_at: new Date().toISOString(),
    }).select("id").single();
    job = data;
  }

  let processed = 0;
  let errors = 0;

  // Clean URL
  let raw = inst.website.trim();
  if (raw.includes("|")) raw = raw.split("|")[0].trim();
  if (raw.includes(";")) raw = raw.split(";")[0].trim();

  if (/\s/.test(raw) || raw === "****" || !raw.includes(".")) {
    await supabase.from("marketing_signals").upsert({
      installer_id: inst.id,
      has_google_analytics: false, has_google_ads: false, has_meta_pixel: false,
      has_crm_tool: false, has_live_chat: false,
      detected_technologies: JSON.stringify(["error:invalid_url"]),
      detection_version: CURRENT_VERSION,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "installer_id" });
    errors++;
  } else {
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
        html = await res.text();
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
    const social: Record<string, string | null> = {
      facebook_url: null, instagram_url: null, linkedin_url: null, twitter_url: null, youtube_url: null,
    };

    if (fetched && html.length > 0) {
      const htmlLower = html.toLowerCase();

      // HTML pattern matching
      for (const tech of TECH_PATTERNS) {
        if (tech.patterns.some((p) => htmlLower.includes(p.toLowerCase()))) {
          detected.push(tech.name);
          if (tech.field === "ga") hasGA = true;
          if (tech.field === "gads") hasGAds = true;
          if (tech.field === "meta") hasMetaPixel = true;
          if (tech.field === "crm" && !hasCrm) { hasCrm = true; crmName = tech.name; }
          if (tech.field === "chat" && !hasChat) { hasChat = true; chatName = tech.name; }
        }
      }

      // Social link extraction (use original HTML for case-sensitive URLs)
      const socialLinks = extractSocialLinks(html);
      Object.assign(social, socialLinks);
    } else {
      detected.push("error:fetch_failed");
      errors++;
    }

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
      facebook_url: social.facebook_url,
      instagram_url: social.instagram_url,
      linkedin_url: social.linkedin_url,
      twitter_url: social.twitter_url,
      youtube_url: social.youtube_url,
      detection_version: CURRENT_VERSION,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "installer_id" });
    processed++;
  }

  if (job?.id) {
    await supabase.from("enrichment_jobs").update({
      processed_items: processed, error_count: errors,
      status: "completed", completed_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  return new Response(JSON.stringify({
    processed,
    errors,
    remaining: remaining - 1,
    message: `Tech detection v${CURRENT_VERSION}: ${processed} processed, ${remaining - 1} remaining`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
