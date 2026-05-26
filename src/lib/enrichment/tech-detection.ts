import dns from "node:dns/promises";

const TECH_PATTERNS: {
  name: string;
  category: string;
  field: string;
  patterns: string[];
}[] = [
  {
    name: "Google Analytics",
    category: "analytics",
    field: "hasGoogleAnalytics",
    patterns: ["gtag(", "google-analytics.com", "googletagmanager.com", "analytics.js", "ga.js"],
  },
  {
    name: "Google Ads",
    category: "ads",
    field: "hasGoogleAds",
    patterns: ["AW-", "googleadservices.com", "google_conversion", "conversion.js", "googleads.g.doubleclick.net", "googlesyndication.com", "adservice.google.com", "ads/ga-audiences"],
  },
  {
    name: "Microsoft Ads",
    category: "ads",
    field: "tech",
    patterns: ["bat.bing.com", "uetag", "UET tag", "clarity.ms", "microsoft.com/muid"],
  },
  {
    name: "Meta Pixel",
    category: "ads",
    field: "hasMetaPixel",
    patterns: ["fbq(", "connect.facebook.net", "facebook-jssdk", "facebook.com/tr"],
  },
  {
    name: "HubSpot",
    category: "crm",
    field: "crm",
    patterns: ["hs-scripts.com", "hubspot.com", "hbspt.forms", "hs-analytics"],
  },
  {
    name: "Salesforce",
    category: "crm",
    field: "crm",
    patterns: ["pardot.com", "salesforce.com", "force.com"],
  },
  {
    name: "Zoho",
    category: "crm",
    field: "crm",
    patterns: ["zoho.com", "zohocdn.com", "salesiq.zoho"],
  },
  {
    name: "Pipedrive",
    category: "crm",
    field: "crm",
    patterns: ["pipedrive.com", "pipedrivewebforms"],
  },
  {
    name: "ActiveCampaign",
    category: "crm",
    field: "crm",
    patterns: ["activecampaign.com", "trackcmp.net"],
  },
  // Solar / installer-specific CRM & sales tools
  {
    name: "Simplified Energy",
    category: "crm",
    field: "crm",
    patterns: ["simplifiedenergy.co", "simplified.energy", "simplifiedenergy.com"],
  },
  {
    name: "Autarc",
    category: "crm",
    field: "crm",
    patterns: ["autarc.energy"],
  },
  {
    name: "Reonic",
    category: "crm",
    field: "crm",
    patterns: ["reonic.de", "reonic.com", "app.reonic"],
  },
  {
    name: "Solar Edge",
    category: "crm",
    field: "crm",
    patterns: ["solaredge.com", "monitoring.solaredge.com"],
  },
  {
    name: "Enphase",
    category: "crm",
    field: "crm",
    patterns: ["enphase.com", "enlighten.enphaseenergy.com"],
  },
  {
    name: "EasySolar",
    category: "crm",
    field: "crm",
    patterns: ["easysolar.com", "easysolar.io"],
  },
  {
    name: "Pylon",
    category: "crm",
    field: "crm",
    patterns: ["pylon.energy", "pylon-network.org"],
  },
  {
    name: "OpenSolar",
    category: "crm",
    field: "crm",
    patterns: ["opensolar.com", "app.opensolar"],
  },
  {
    name: "Sunstak",
    category: "crm",
    field: "crm",
    patterns: ["sunstak.com", "sunstak.co.uk"],
  },
  {
    name: "JobNimbus",
    category: "crm",
    field: "crm",
    patterns: ["jobnimbus.com", "app.jobnimbus.com"],
  },
  {
    name: "Commusoft",
    category: "crm",
    field: "crm",
    patterns: ["commusoft.co.uk", "commusoft.com"],
  },
  {
    name: "SimPRO",
    category: "crm",
    field: "crm",
    patterns: ["simpro.co", "simprogroup.com"],
  },
  {
    name: "Tradify",
    category: "crm",
    field: "crm",
    patterns: ["tradifyhq.com", "tradify.com"],
  },
  {
    name: "Keap",
    category: "crm",
    field: "crm",
    patterns: ["keap.com", "infusionsoft.com", "keap.app"],
  },
  {
    name: "Monday.com",
    category: "crm",
    field: "crm",
    patterns: ["monday.com"],
  },
  {
    name: "Freshsales",
    category: "crm",
    field: "crm",
    patterns: ["freshsales.io", "freshworks.com"],
  },
  {
    name: "Tawk.to",
    category: "chat",
    field: "chat",
    patterns: ["tawk.to", "embed.tawk.to"],
  },
  {
    name: "Intercom",
    category: "chat",
    field: "chat",
    patterns: ["intercom.io", "intercomcdn.com", "widget.intercom.io"],
  },
  {
    name: "Drift",
    category: "chat",
    field: "chat",
    patterns: ["drift.com", "js.driftt.com"],
  },
  {
    name: "Crisp",
    category: "chat",
    field: "chat",
    patterns: ["crisp.chat", "client.crisp.chat"],
  },
  {
    name: "Zendesk",
    category: "chat",
    field: "chat",
    patterns: ["zdassets.com", "zendesk.com", "zopim.com"],
  },
  {
    name: "LiveChat",
    category: "chat",
    field: "chat",
    patterns: ["livechatinc.com", "livechat.com"],
  },
  {
    name: "Google Tag Manager",
    category: "tagmanager",
    field: "tech",
    patterns: ["googletagmanager.com/gtm.js", "GTM-"],
  },
  {
    name: "Hotjar",
    category: "analytics",
    field: "tech",
    patterns: ["hotjar.com", "static.hotjar.com"],
  },
  {
    name: "Mailchimp",
    category: "email",
    field: "tech",
    patterns: ["mailchimp.com", "list-manage.com", "chimpstatic.com"],
  },
];

// DNS-based detection: patterns matched against TXT and CNAME records
const DNS_PATTERNS: { name: string; category: string; field: string; patterns: string[] }[] = [
  // CRM verification TXT records
  { name: "HubSpot", category: "crm", field: "crm", patterns: ["hubspot", "hs-site-verification"] },
  { name: "Salesforce", category: "crm", field: "crm", patterns: ["salesforce", "pardot"] },
  { name: "Zoho", category: "crm", field: "crm", patterns: ["zoho"] },
  { name: "ActiveCampaign", category: "crm", field: "crm", patterns: ["activecampaign"] },
  { name: "Keap", category: "crm", field: "crm", patterns: ["infusionsoft", "keap"] },
  { name: "Freshsales", category: "crm", field: "crm", patterns: ["freshworks", "freshsales"] },
  // Solar / installer-specific tools
  { name: "Simplified Energy", category: "crm", field: "crm", patterns: ["simplifiedenergy"] },
  { name: "Autarc", category: "crm", field: "crm", patterns: ["autarc.energy", "autarc"] },
  { name: "Reonic", category: "crm", field: "crm", patterns: ["reonic"] },
  { name: "EasySolar", category: "crm", field: "crm", patterns: ["easysolar"] },
  { name: "OpenSolar", category: "crm", field: "crm", patterns: ["opensolar"] },
  { name: "Sunstak", category: "crm", field: "crm", patterns: ["sunstak"] },
  { name: "JobNimbus", category: "crm", field: "crm", patterns: ["jobnimbus"] },
  { name: "Commusoft", category: "crm", field: "crm", patterns: ["commusoft"] },
  { name: "SimPRO", category: "crm", field: "crm", patterns: ["simpro"] },
  { name: "Tradify", category: "crm", field: "crm", patterns: ["tradify"] },
  // Email / marketing platforms (often show up in SPF/DKIM TXT records)
  { name: "Mailchimp", category: "email", field: "tech", patterns: ["mailchimp", "mandrillapp", "mcsv.net"] },
  { name: "SendGrid", category: "email", field: "tech", patterns: ["sendgrid"] },
  { name: "Mailgun", category: "email", field: "tech", patterns: ["mailgun"] },
];

function extractDomain(websiteUrl: string): string | null {
  try {
    const url = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function lookupDnsRecords(domain: string): Promise<string[]> {
  const records: string[] = [];
  try {
    const txt = await dns.resolveTxt(domain);
    for (const entry of txt) records.push(entry.join(" "));
  } catch {}
  try {
    const cnames = await dns.resolveCname(domain);
    records.push(...cnames);
  } catch {}
  return records;
}

function detectDnsPatterns(dnsRecords: string[]): { detected: string[]; crm: { name: string } | null } {
  const lowerRecords = dnsRecords.map((r) => r.toLowerCase());
  const detected: string[] = [];
  let crm: { name: string } | null = null;

  for (const tech of DNS_PATTERNS) {
    const found = tech.patterns.some((p) => lowerRecords.some((r) => r.includes(p.toLowerCase())));
    if (!found) continue;
    detected.push(tech.name);
    if (tech.field === "crm" && !crm) crm = { name: tech.name };
  }

  return { detected, crm };
}

// --- Social media link extraction ---

const SOCIAL_PATTERNS: { platform: string; regex: RegExp; exclude: RegExp }[] = [
  {
    platform: "facebook",
    regex: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?)['"]/gi,
    exclude: /facebook\.com\/(sharer|share|dialog|plugins|tr|hashtag|flx|watch|groups\/\d|pages\/category|login|help|policies)/i,
  },
  {
    platform: "instagram",
    regex: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?)['"]/gi,
    exclude: /instagram\.com\/(explore|accounts|p\/|reel\/|stories\/|about|developer|legal)/i,
  },
  {
    platform: "linkedin",
    regex: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?)['"]/gi,
    exclude: /linkedin\.com\/(share|sharing|pulse|jobs|learning|feed)/i,
  },
  {
    platform: "twitter",
    regex: /href=["'](https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?)['"]/gi,
    exclude: /(?:twitter|x)\.com\/(intent|share|hashtag|search|home|i\/|widgets)/i,
  },
  {
    platform: "youtube",
    regex: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)[a-zA-Z0-9._-]+\/?)['"]/gi,
    exclude: /youtube\.com\/(watch|embed|playlist|results|feed|shorts)/i,
  },
];

export function extractSocialLinks(html: string): Record<string, string | null> {
  const links: Record<string, string | null> = {
    facebookUrl: null,
    instagramUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    youtubeUrl: null,
  };

  for (const { platform, regex, exclude } of SOCIAL_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      if (!exclude.test(url)) {
        const key = `${platform}Url` as keyof typeof links;
        links[key] = url.replace(/\/$/, ""); // normalize trailing slash
        break; // take the first valid match
      }
    }
  }

  return links;
}

export function detectTechnologies(html: string, dnsResults?: { detected: string[]; crm: { name: string } | null }) {
  const detected: string[] = [];
  let hasGA = false;
  let hasGAds = false;
  let hasMetaPixel = false;
  let hasCrm = false;
  let crmName: string | null = null;
  let hasChat = false;
  let chatName: string | null = null;

  const lowerHtml = html.toLowerCase();

  for (const tech of TECH_PATTERNS) {
    const found = tech.patterns.some((p) => lowerHtml.includes(p.toLowerCase()));
    if (!found) continue;

    detected.push(tech.name);

    switch (tech.field) {
      case "hasGoogleAnalytics":
        hasGA = true;
        break;
      case "hasGoogleAds":
        hasGAds = true;
        break;
      case "hasMetaPixel":
        hasMetaPixel = true;
        break;
      case "crm":
        hasCrm = true;
        crmName = tech.name;
        break;
      case "chat":
        hasChat = true;
        chatName = tech.name;
        break;
    }
  }

  // Merge DNS-based detections (avoid duplicates)
  if (dnsResults) {
    for (const name of dnsResults.detected) {
      if (!detected.includes(name)) detected.push(name);
    }
    if (!hasCrm && dnsResults.crm) {
      hasCrm = true;
      crmName = dnsResults.crm.name;
    }
  }

  return {
    detected,
    hasGoogleAnalytics: hasGA,
    hasGoogleAds: hasGAds,
    hasMetaPixel: hasMetaPixel,
    hasCrmTool: hasCrm,
    crmToolName: crmName,
    hasLiveChat: hasChat,
    liveChatTool: chatName,
  };
}

// Batch enrichment (enrichTechDetection) removed — now handled by Supabase Edge Function
// Only detectTechnologies() and extractSocialLinks() are kept for individual installer enrichment
