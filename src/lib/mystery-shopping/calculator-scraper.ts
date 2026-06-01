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
import { scrapeEcoProvidersApi } from "./scrapers/ecoproviders-api";
import { scrapeMakeMyHouseGreen } from "./scrapers/makemyhousegreen";
import { scrapeGlowGreen } from "./scrapers/glowgreen";
import { scrapeEseSolar } from "./scrapers/esesolar";
import { scrapeStagSolarApi, createSimplifiedEnergyScraper } from "./scrapers/stagsolar-api";
import { scrapeOctopusEnergy } from "./scrapers/octopus-energy";
import { scrapeGeneric } from "./scrapers/generic";

// Simplified Energy v2 installers — confirmed to redirect to /solar-planner-v2/
// Verified 2026-06-01: each entry's /solar page redirects to v2 planner
const SIMPLIFIED_ENERGY_INSTALLERS: Array<{ installerId: number; name: string; host: string; tenantId: string; quoteId: string }> = [
  { installerId: 5775, name: "Stag Solar Solutions", host: "quote.stagsolar.com", tenantId: "lRCr4ktLaMGx7wfIj7TFI", quoteId: "RNE47M6TFW" },
  { installerId: 6338, name: "Viable Power Solutions Ltd", host: "quote.viablepower.co.uk", tenantId: "fIyvrhxtErJ0XX0P18552", quoteId: "GRXRFR4TQ4" },
  { installerId: 1271, name: "Cotswold Energy", host: "solar.cotswold.energy", tenantId: "sx5kOjE5DMsuTp901z6DL", quoteId: "SQVRA59GAW" },
  { installerId: 383, name: "All Seasons Energy Ltd", host: "quote.allseasonsenergy.co.uk", tenantId: "Y0Sd7lGJu0CdPobeBzTms", quoteId: "81FJ2R268Y" },
  { installerId: 1675, name: "E-Verve Energy Ltd", host: "quote.e-verveenergy.co.uk", tenantId: "Cned89cc4my2FgKZUIHVd", quoteId: "XH8PE38N6M" },
  { installerId: 1902, name: "EE Renewables Ltd", host: "app.eerenewables.co.uk", tenantId: "HMGJf9p3bNvHxpgomgCP9", quoteId: "33A1H3B1JR" },
  { installerId: 2627, name: "Grant Store Ltd", host: "start.grant-store.com", tenantId: "21EQptwAQqMnYRnsSfBhn", quoteId: "PH7GPKXAJ1" },
  { installerId: 5753, name: "Square1 Installations Ltd", host: "app.sq1i.co.uk", tenantId: "BbEmPnRJK74K2qnc14R3tQ46EpFEys", quoteId: "N125JW7BJA" },
  { installerId: 2424, name: "FutureHeat", host: "quote.futureheatltd.co.uk", tenantId: "hI8TC1WWd9cHZhJMfHLw2", quoteId: "18Y5NKGBAJ" },
  { installerId: 4225, name: "New Dawn Energy", host: "quote.newdawnsolar.co.uk", tenantId: "yXYvJMWqW30juHDQuBzwA", quoteId: "9A92TT89Q3" },
  { installerId: 410, name: "AlphaOne Electrics", host: "quote.alphaoneelectrics.co.uk", tenantId: "O5LULLAE0U2AmPplY8Dh4", quoteId: "HQ3KCACVBE" },
  { installerId: 5209, name: "Samso", host: "app.samsoenergy.co.uk", tenantId: "6vmsA9WrccCr3tuxzp46l", quoteId: "4KBY4Y2YAF" },
  { installerId: 6069, name: "The Energy Experts", host: "quote.the-energy-experts.co.uk", tenantId: "ET1t3CE47H2cg3ELTY_ZM", quoteId: "2QYYJYANX3" },
  { installerId: 4009, name: "Menai Heating", host: "quote.menaiheating.co.uk", tenantId: "RGDoLJcZuHqE5zRapYZ-B", quoteId: "23FBCF7P73" },
  { installerId: 3927, name: "Marshall (Clean Heat and Power)", host: "app.marshallenergy.co.uk", tenantId: "NBdZ3NCDOm5MAh-e5G8ci", quoteId: "YF5NV5F9K5" },
  { installerId: 6098, name: "The Natural Energy Company", host: "app.thenaturalenergycompany.co.uk", tenantId: "OQ-57CkV4By9JdzRqLTiR", quoteId: "DMH9GCXV4F" },
  { installerId: 3646, name: "LCS Energy", host: "quote.lcsenergy.co.uk", tenantId: "YgdcNo7yA-TS0wVfLlgcK", quoteId: "8QKRNQ3E5W" },
  { installerId: 5128, name: "RR Electrical and Solar", host: "quote.rrelectricalandsolar.co.uk", tenantId: "xJhwhQAm7ZNfmiW7kESt1", quoteId: "NHDKHYRP2S" },
  { installerId: 3695, name: "The Solar People", host: "quote.thesolarpeople.co.uk", tenantId: "8_h2RLenn8seSpvBdrbl0", quoteId: "FYEPMCQ6X5" },
  // Auto-generated quote IDs (confirmed v2 via solar.simplified.energy redirect)
  { installerId: 1941, name: "Electech Engineering Services", host: "", tenantId: "eTc1ChzfSdtwxf5KxPliM", quoteId: "" },
  { installerId: 4277, name: "Nightingale Electrical", host: "", tenantId: "UepOaVtvXYFSFj8M7o6kB", quoteId: "" },
  { installerId: 5652, name: "Solr", host: "", tenantId: "X9OeZf3r9a1Sx1MJTB7Ts", quoteId: "" },
  { installerId: 5712, name: "Spark Energy UK", host: "", tenantId: "VhmuJgD0avzqgfI32IAwH", quoteId: "" },
  { installerId: 5943, name: "Switched On", host: "", tenantId: "-ng4Ba8FXMcUNjz04cHcv", quoteId: "" },
  // Confirmed v2-active — redirect at / or direct GET to /solar-planner-v2/
  { installerId: 2252, name: "EVi Renewables", host: "app.eviuk.co.uk", tenantId: "S5h3NUrlWqmlLk0Gzqw1s", quoteId: "" },
  { installerId: 1511, name: "Devon Renewables", host: "quote.devonrenewables.co.uk", tenantId: "eYuyS_kGQvg9x_bL1YgR9", quoteId: "" },
  { installerId: 1229, name: "Conscious Energy", host: "quote.consciousenergy.co.uk", tenantId: "yPflvX3t_4Wp8gPO1--eo", quoteId: "" },
  { installerId: 2242, name: "Evergreen Power UK Ltd", host: "solarquote.evergreenpoweruk.com", tenantId: "Q7T-pbkeY25KnjAGMqwMQ", quoteId: "" },
  { installerId: 794, name: "Bloom Renewables", host: "solar.simplified.energy", tenantId: "93C4wXMVbD2TKXweU4xih", quoteId: "" },
  { installerId: 6211, name: "Total Renewable Solutions", host: "quote.totalrenewablesolutions.com", tenantId: "0DL7MAIf0fz3CJ8PCIGcB", quoteId: "" },
  { installerId: 3128, name: "Infinite Energy", host: "solar.infiniteenergy.io", tenantId: "dOHeeiE5VFu6VyBoqq6nx", quoteId: "" },
  { installerId: 6312, name: "Urbn Solar", host: "quote.urbnsolar.uk", tenantId: "xFVGLsKZl3HrE5AE3ray8", quoteId: "" },
];

// Removed — NOT on v2 planner:
// Solar Star Power (5548) — v1 planner, missing solar-only packages
// Solar Techs (5560) — no redirect to planner
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

// ── API-based scrapers (instant, no browser needed) ──────────────────
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
    useApi: true,
    scraperFn: scrapeEcoProvidersApi,
  },
  {
    installerId: 4368,
    companyName: "Octopus Energy",
    calculatorUrl: "https://octopus.energy/order/solar/",
    useApi: true, // Manages its own Browserbase session — don't launch local Playwright
    scraperFn: scrapeOctopusEnergy,
  },
  // All Simplified Energy installers (same API, different tenants)
  ...SIMPLIFIED_ENERGY_INSTALLERS
    .map((se) => ({
      installerId: se.installerId,
      companyName: se.name,
      calculatorUrl: se.host
        ? `https://${se.host}/solar`
        : `https://solar.simplified.energy/${se.tenantId}`,
      useApi: true,
      scraperFn: createSimplifiedEnergyScraper({
        host: se.host,
        tenantId: se.tenantId,
        quoteId: se.quoteId,
      }),
    })),
];

// ── Browser-based scrapers (need Playwright, not yet fully working) ──
// These require a headed Chrome window and need further tuning.
// Uncomment to enable — they will open a browser popup when scraping.
export const BROWSER_SCRAPERS_DISABLED: ScraperConfig[] = [
  {
    installerId: 2917,
    companyName: "Heatable Ltd",
    calculatorUrl: "https://heatable.co.uk/solar/quote",
    scraperFn: scrapeHeatable,
  },
  {
    installerId: 5941,
    companyName: "MakeMyHouseGreen (Switchd Ltd)",
    calculatorUrl: "https://makemyhousegreen.com/",
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
