import { db } from "@/lib/db";
import {
  installers,
  mysteryShopTargets,
  mysteryShopZoneProperties,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getBrowser, createContext, closeBrowser, type PropertyInput, type ScraperResult } from "./scrapers/base";
import { scrapeBoxt } from "./scrapers/boxt";
import { scrapeBoxtApi } from "./scrapers/boxt-api";
import { scrapeSolarFastApi } from "./scrapers/solarfast-api";
import { scrapeIheat } from "./scrapers/iheat-api";
import { scrapeIheatApi } from "./scrapers/iheat-direct-api";
import { scrapeHeatable } from "./scrapers/heatable";
import { scrapeEcoProviders } from "./scrapers/ecoproviders";
import { scrapeEcoProvidersSolar } from "./scrapers/ecoproviders-solar";
import { scrapeMakeMyHouseGreen } from "./scrapers/makemyhousegreen";
import { scrapeGlowGreen } from "./scrapers/glowgreen";
import { scrapeEseSolar } from "./scrapers/esesolar";
import { scrapeGeneric } from "./scrapers/generic";
import { extractPostcodeArea, UK_ZONES } from "@/lib/constants";
import type { Page } from "playwright";

// ── Scraper Registry ──────────────────────────────────────────
// Manually configured: each entry maps an installer ID to its
// calculator URL and custom scraper function.
// Add new installers here as you discover them.
//
// Set `useApi: true` for scrapers that call the installer's API
// directly (no browser needed). These are faster and more reliable.

export interface ScraperConfig {
  installerId: number;
  companyName: string;
  calculatorUrl: string;
  useApi?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scraperFn: (page: any, url: string, property: PropertyInput) => Promise<ScraperResult>;
}

export const CALCULATOR_REGISTRY: ScraperConfig[] = [
  {
    installerId: 839,
    companyName: "BOXT Limited",
    calculatorUrl: "https://app.boxt.co.uk/solar/configurator",
    useApi: true,
    scraperFn: scrapeBoxtApi,
  },
  {
    installerId: 3103,
    companyName: "iHeat",
    calculatorUrl: "https://iheat.co.uk/quote/solar",
    useApi: true,
    scraperFn: scrapeIheatApi,
  },
  {
    installerId: 2917,
    companyName: "Heatable Ltd",
    calculatorUrl: "https://heatable.co.uk/solar/quote",
    scraperFn: scrapeHeatable,
  },
  {
    installerId: 2483,
    companyName: "Wickes Solar (Gas Fast Limited)",
    calculatorUrl: "https://www.wickes.co.uk/wickes-solar/solar-price-estimator",
    useApi: true,
    scraperFn: scrapeSolarFastApi,
  },
  {
    installerId: 1775,
    companyName: "Eco Providers Ltd",
    calculatorUrl: "https://www.ecoproviders.co.uk/solar-fixed-quote-form/",
    scraperFn: scrapeEcoProvidersSolar,
  },
  {
    installerId: 5941,
    companyName: "MakeMyHouseGreen (Switchd Ltd)",
    calculatorUrl: "https://makemyhousegreen.com/",
    useApi: true,
    scraperFn: scrapeMakeMyHouseGreen,
  },
  {
    installerId: 2570,
    companyName: "Glow Green Limited",
    calculatorUrl: "https://www.glowgreenltd.com/solar/quote",
    scraperFn: scrapeGlowGreen,
  },
  {
    installerId: 2192,
    companyName: "ESE Solar Limited",
    calculatorUrl: "https://esesolar.co.uk/solar-form/",
    scraperFn: scrapeEseSolar,
  },
];

/**
 * Get all configured calculator installers.
 * Optionally filter by zone IDs.
 */
export async function findCalculatorInstallers(options?: {
  zones?: string[];
}) {
  let entries = CALCULATOR_REGISTRY;

  if (options?.zones && options.zones.length > 0) {
    // Look up postcodes for each configured installer
    const installerIds = entries.map((e) => e.installerId);
    const rows = await db
      .select({ id: installers.id, postcode: installers.postcode })
      .from(installers)
      .where(sql`${installers.id} IN (${sql.join(installerIds.map(id => sql`${id}`), sql`, `)})`);

    const postcodeMap = new Map(rows.map((r) => [r.id, r.postcode]));

    const zonePrefixes = new Set<string>();
    for (const zone of UK_ZONES) {
      if (options.zones.includes(zone.id)) {
        zone.postcodePrefixes.forEach((p) => zonePrefixes.add(p));
      }
    }

    entries = entries.filter((e) => {
      const postcode = postcodeMap.get(e.installerId);
      if (!postcode) return true; // Include if we can't determine zone
      const area = extractPostcodeArea(postcode);
      return area ? zonePrefixes.has(area) : true;
    });
  }

  return entries;
}

/**
 * Get the property input for a given zone ID.
 */
export async function getPropertyForZone(zoneId: string): Promise<PropertyInput | null> {
  const [prop] = await db
    .select()
    .from(mysteryShopZoneProperties)
    .where(eq(mysteryShopZoneProperties.zoneId, zoneId));

  if (!prop) return null;

  const details = prop.details ? JSON.parse(prop.details) : {};
  return {
    address: prop.address,
    postcode: prop.postcode,
    ...details,
  };
}

/**
 * Get the property details for a zone based on an installer's postcode.
 */
async function getPropertyForInstaller(installerId: number): Promise<PropertyInput | null> {
  const [inst] = await db
    .select({ postcode: installers.postcode })
    .from(installers)
    .where(eq(installers.id, installerId));

  if (!inst?.postcode) return null;
  const area = extractPostcodeArea(inst.postcode);
  if (!area) return null;

  const zone = UK_ZONES.find((z) =>
    (z.postcodePrefixes as readonly string[]).includes(area)
  );
  if (!zone) return null;

  return getPropertyForZone(zone.id);
}

/**
 * Scrape a single installer's calculator using the registry config.
 * For API-based scrapers (useApi=true), no browser is launched.
 */
export async function scrapeInstallerCalculator(
  config: ScraperConfig
): Promise<ScraperResult> {
  const property = await getPropertyForInstaller(config.installerId);
  if (!property) {
    return {
      success: false,
      platform: config.companyName,
      rawData: null,
      screenshotPath: null,
      error: "No zone property configured for this installer's postcode area",
    };
  }

  // API-based scrapers don't need a browser
  if (config.useApi) {
    return config.scraperFn(null, config.calculatorUrl, property);
  }

  // Browser-based scrapers need Playwright
  const browser = await getBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    return await config.scraperFn(page, config.calculatorUrl, property);
  } finally {
    await context.close();
  }
}

/**
 * Process a batch of calculator targets for a campaign.
 */
export async function processCalculatorBatch(
  campaignId: number,
  batchSize: number = 5
): Promise<{ processed: number; errors: number; remaining: number }> {
  const targets = await db
    .select()
    .from(mysteryShopTargets)
    .where(
      and(
        eq(mysteryShopTargets.campaignId, campaignId),
        eq(mysteryShopTargets.category, "calculator"),
        eq(mysteryShopTargets.status, "pending")
      )
    )
    .limit(batchSize);

  if (targets.length === 0) {
    return { processed: 0, errors: 0, remaining: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const target of targets) {
    const config = CALCULATOR_REGISTRY.find((c) => c.installerId === target.installerId);
    if (!config) {
      await db
        .update(mysteryShopTargets)
        .set({ status: "failed", errorLog: JSON.stringify(["No scraper configured for this installer"]) })
        .where(eq(mysteryShopTargets.id, target.id));
      errors++;
      continue;
    }

    // Mark as submitting
    await db
      .update(mysteryShopTargets)
      .set({ status: "submitting", submittedAt: new Date().toISOString() })
      .where(eq(mysteryShopTargets.id, target.id));

    const result = await scrapeInstallerCalculator(config);

    if (result.success) {
      await db
        .update(mysteryShopTargets)
        .set({
          status: "response_received",
          responseFormat: "web_calculator",
          rawResponseData: JSON.stringify(result.rawData),
          formData: JSON.stringify({ platform: result.platform, screenshotPath: result.screenshotPath }),
          aiParseStatus: "pending",
        })
        .where(eq(mysteryShopTargets.id, target.id));
      processed++;
    } else {
      const existingLog = target.errorLog ? JSON.parse(target.errorLog) : [];
      existingLog.push(result.error);
      await db
        .update(mysteryShopTargets)
        .set({ status: "failed", errorLog: JSON.stringify(existingLog) })
        .where(eq(mysteryShopTargets.id, target.id));
      errors++;
    }
  }

  // Count remaining
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(mysteryShopTargets)
    .where(
      and(
        eq(mysteryShopTargets.campaignId, campaignId),
        eq(mysteryShopTargets.category, "calculator"),
        eq(mysteryShopTargets.status, "pending")
      )
    );

  await closeBrowser();

  return { processed, errors, remaining: Number(count) };
}
