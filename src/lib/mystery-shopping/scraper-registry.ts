// Lightweight registry of installers that have price calculators.
// This file has NO heavy dependencies (no Playwright, no scraper functions)
// so it's safe to import from server components / Vercel serverless functions.
//
// The full ScraperConfig (with scraperFn) lives in calculator-scraper.ts
// and should only be imported by API routes that actually run scrapers.

// Simplified Energy v2 installers — confirmed to redirect to /solar-planner-v2/
// Verified 2026-06-01: each entry's /solar page redirects to v2 planner
const SIMPLIFIED_ENERGY_INSTALLERS: Array<{ installerId: number; name: string; host: string; tenantId: string }> = [
  { installerId: 5775, name: "Stag Solar Solutions", host: "quote.stagsolar.com", tenantId: "lRCr4ktLaMGx7wfIj7TFI" },
  { installerId: 6338, name: "Viable Power Solutions Ltd", host: "quote.viablepower.co.uk", tenantId: "fIyvrhxtErJ0XX0P18552" },
  { installerId: 1271, name: "Cotswold Energy", host: "solar.cotswold.energy", tenantId: "sx5kOjE5DMsuTp901z6DL" },
  { installerId: 1675, name: "E-Verve Energy Ltd", host: "quote.e-verveenergy.co.uk", tenantId: "Cned89cc4my2FgKZUIHVd" },
  { installerId: 1902, name: "EE Renewables Ltd", host: "app.eerenewables.co.uk", tenantId: "HMGJf9p3bNvHxpgomgCP9" },
  { installerId: 2627, name: "Grant Store Ltd", host: "start.grant-store.com", tenantId: "21EQptwAQqMnYRnsSfBhn" },
  { installerId: 5753, name: "Square1 Installations Ltd", host: "app.sq1i.co.uk", tenantId: "BbEmPnRJK74K2qnc14R3tQ46EpFEys" },
  { installerId: 4225, name: "New Dawn Energy", host: "quote.newdawnsolar.co.uk", tenantId: "yXYvJMWqW30juHDQuBzwA" },
  { installerId: 410, name: "AlphaOne Electrics", host: "quote.alphaoneelectrics.co.uk", tenantId: "O5LULLAE0U2AmPplY8Dh4" },
  { installerId: 6069, name: "The Energy Experts", host: "quote.the-energy-experts.co.uk", tenantId: "ET1t3CE47H2cg3ELTY_ZM" },
  { installerId: 4009, name: "Menai Heating", host: "quote.menaiheating.co.uk", tenantId: "RGDoLJcZuHqE5zRapYZ-B" },
  { installerId: 3927, name: "Marshall (Clean Heat and Power)", host: "app.marshallenergy.co.uk", tenantId: "NBdZ3NCDOm5MAh-e5G8ci" },
  { installerId: 6098, name: "The Natural Energy Company", host: "app.thenaturalenergycompany.co.uk", tenantId: "OQ-57CkV4By9JdzRqLTiR" },
  { installerId: 3646, name: "LCS Energy", host: "quote.lcsenergy.co.uk", tenantId: "YgdcNo7yA-TS0wVfLlgcK" },
  { installerId: 5128, name: "RR Electrical and Solar", host: "quote.rrelectricalandsolar.co.uk", tenantId: "xJhwhQAm7ZNfmiW7kESt1" },
  { installerId: 2252, name: "EVi Renewables", host: "app.eviuk.co.uk", tenantId: "S5h3NUrlWqmlLk0Gzqw1s" },
  { installerId: 1511, name: "Devon Renewables", host: "quote.devonrenewables.co.uk", tenantId: "eYuyS_kGQvg9x_bL1YgR9" },
  { installerId: 1229, name: "Conscious Energy", host: "quote.consciousenergy.co.uk", tenantId: "yPflvX3t_4Wp8gPO1--eo" },
  { installerId: 2242, name: "Evergreen Power UK Ltd", host: "solarquote.evergreenpoweruk.com", tenantId: "Q7T-pbkeY25KnjAGMqwMQ" },
  { installerId: 794, name: "Bloom Renewables", host: "solar.simplified.energy", tenantId: "93C4wXMVbD2TKXweU4xih" },
  { installerId: 6211, name: "Total Renewable Solutions", host: "quote.totalrenewablesolutions.com", tenantId: "0DL7MAIf0fz3CJ8PCIGcB" },
];

export interface ScraperRegistryEntry {
  installerId: number;
  companyName: string;
  calculatorUrl: string;
}

export const SCRAPER_REGISTRY: ScraperRegistryEntry[] = [
  { installerId: 839, companyName: "BOXT Limited", calculatorUrl: "https://app.boxt.co.uk/solar/configurator" },
  { installerId: 3103, companyName: "iHeat", calculatorUrl: "https://iheat.co.uk/quote/solar" },
  { installerId: 2483, companyName: "Wickes Solar (Gas Fast Limited)", calculatorUrl: "https://www.wickes.co.uk/wickes-solar/solar-price-estimator" },
  { installerId: 1775, companyName: "Eco Providers Ltd", calculatorUrl: "https://www.ecoproviders.co.uk/solar-fixed-quote-form/" },
  { installerId: 4368, companyName: "Octopus Energy", calculatorUrl: "https://octopus.energy/order/solar/" },
  ...SIMPLIFIED_ENERGY_INSTALLERS.map((se) => ({
    installerId: se.installerId,
    companyName: se.name,
    calculatorUrl: se.host
      ? `https://${se.host}/solar`
      : `https://solar.simplified.energy/${se.tenantId}`,
  })),
];
