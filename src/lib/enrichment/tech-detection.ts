import { db } from "@/lib/db";
import {
  installers,
  marketingSignals,
  enrichmentJobs,
} from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { RateLimiter } from "./rate-limiter";

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
    patterns: ["gtag(", "google-analytics.com", "googletagmanager.com", "G-", "UA-", "analytics.js", "ga.js"],
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

function detectTechnologies(html: string) {
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

export async function enrichTechDetection(
  jobId: number,
  installerIds?: number[]
) {
  const query = installerIds
    ? db
        .select({ id: installers.id, website: installers.website })
        .from(installers)
        .where(
          sql`${installers.id} IN (${sql.join(
            installerIds.map((id) => sql`${id}`),
            sql`,`
          )}) AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`
        )
    : db
        .select({ id: installers.id, website: installers.website })
        .from(installers)
        .leftJoin(
          marketingSignals,
          eq(installers.id, marketingSignals.installerId)
        )
        .where(
          sql`${marketingSignals.id} IS NULL AND ${installers.website} IS NOT NULL AND ${installers.website} != ''`
        );

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

  // Process in parallel batches of 20
  for (let i = 0; i < toEnrich.length; i += 20) {
    // Check if job was cancelled
    const [currentJob] = await db
      .select({ status: enrichmentJobs.status })
      .from(enrichmentJobs)
      .where(eq(enrichmentJobs.id, jobId))
      .limit(1);
    if (currentJob?.status === "cancelled") break;

    const batch = toEnrich.slice(i, i + 20).filter((inst) => inst.website);

    const results = await Promise.allSettled(
      batch.map(async (installer) => {
        const url = installer.website!.startsWith("http")
          ? installer.website!
          : `https://${installer.website}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; InstallerCRM/1.0)",
          },
          redirect: "follow",
        });
        clearTimeout(timeout);

        const html = await res.text();
        const tech = detectTechnologies(html);

        await db.insert(marketingSignals).values({
          installerId: installer.id,
          hasMetaAds: null,
          metaAdCount: null,
          metaAdLastSeen: null,
          hasGoogleAnalytics: tech.hasGoogleAnalytics,
          hasGoogleAds: tech.hasGoogleAds,
          hasMetaPixel: tech.hasMetaPixel,
          hasCrmTool: tech.hasCrmTool,
          crmToolName: tech.crmToolName,
          hasLiveChat: tech.hasLiveChat,
          liveChatTool: tech.liveChatTool,
          detectedTechnologies: JSON.stringify(tech.detected),
          estimatedMonthlyTraffic: null,
          estimatedAdSpend: null,
          fetchedAt: new Date().toISOString(),
        });
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
      errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(eq(enrichmentJobs.id, jobId));
}
