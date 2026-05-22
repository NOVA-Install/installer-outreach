/**
 * Merge confirmed duplicate installer pairs and fix websites.
 *
 * Usage:
 *   npx tsx scripts/merge-duplicates.ts
 */

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 3 });

// ── Pairs to merge ──
// Format: [primaryId, secondaryId]
// Primary = the one with more data (email, website); secondary gets merged in and deleted.
// We pick the record with more populated fields as primary. Where both have data, lower ID wins.
const MERGE_PAIRS: [number, number][] = [
  // Final 4 uncertain pairs confirmed by user
  [223, 224],   // ACJ Electrical Installations Ltd — primary=223 (acjelectricalinstallations.co.uk)
  [2007, 2008], // Electrosmith Ltd — primary=2007 (solarsmith.co.uk)
  [3586, 3587], // KVB Renewables Ltd — primary=3586 (kvbrenewables.co.uk)
  [5017, 5018], // Retro Green Solutions Ltd — primary=5017
];

// ── Website fixes (separate companies, NOT merging) ──
const WEBSITE_FIXES: { id: number; website: string | null }[] = [
  // Excluded pairs — set correct website
  { id: 1253, website: null },                              // Coppersolar: clear (was cpsl-group.com)
  { id: 2422, website: "futureflowelectrical.co.uk" },     // Future Flow Electrical
  { id: 3233, website: null },                              // J F & H Dowds: clear (was dowdsgroup.com)
  { id: 3967, website: "mcguinnessgrp.co.uk" },            // McGuinness Electrical Contractors
  { id: 4064, website: "mitchell-roofing.co.uk" },          // Mitchell Roofing (SW) LTD
  { id: 4479, website: "pacsolar.co.uk" },                  // PAC Solar
  { id: 4764, website: "pulserenewablesnw.co.uk" },         // Pulse Renewables NW Ltd
  { id: 5414, website: "smsenergy.com" },                   // SMS
  // Uncertain pairs — clear wrong websites
  { id: 1517, website: null },                              // DFC Electrical (SA61): clear dfc-electrical.co.uk
  { id: 2025, website: null },                              // Elite Electrical (WS7): clear elite-electrical.net
  { id: 2639, website: null },                              // Green Bulb Energy (CT13): clear evenabled.co.uk
  { id: 6112, website: null },                              // The Solar Battery Company (LE12): clear
];

// ── Merge logic ──

interface InstallerRow {
  id: number;
  company_name: string;
  email: string | null;
  website: string | null;
  telephone: string | null;
  address: string | null;
  postcode: string | null;
  county: string | null;
  installer_id: string | null;
  legal_entity_name: string | null;
  legal_entity_number: string | null;
  alternative_names: string | null;
  in_mcs: boolean | null;
  in_nova: boolean | null;
  in_trustmark: boolean | null;
  source_count: number | null;
  certification_number: string | null;
  certification_body: string | null;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  website_status: string | null;
  website_sources: string | null;
  email_sources: string | null;
  telephone_sources: string | null;
  address_sources: string | null;
  company_name_sources: string | null;
  boiler_upgrade_scheme: string | null;
  technologies_certified: string | null;
  regions_covered: string | null;
  nova_year_started: string | null;
  nova_battery_storage: string | null;
  nova_location_area: string | null;
  nova_incorporated_name: string | null;
  nova_enf_profile_url: string | null;
  trustmark_tmln: string | null;
  trustmark_district: string | null;
  trustmark_region: string | null;
  trustmark_national_coverage: string | null;
  trustmark_scheme_providers: string | null;
  trustmark_member_since: string | null;
  trustmark_description: string | null;
  trustmark_profile_url: string | null;
  trustmark_status: string | null;
  pipeline_stage: string | null;
}

function countPopulated(row: InstallerRow): number {
  let count = 0;
  const fields = [
    row.email, row.website, row.telephone, row.address, row.postcode,
    row.county, row.installer_id, row.legal_entity_name, row.certification_number,
    row.nova_enf_profile_url, row.trustmark_tmln,
  ];
  for (const f of fields) {
    if (f != null && f !== "") count++;
  }
  return count;
}

function first(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) if (v != null && v !== "") return v;
  return null;
}

function mergeSources(a: string | null, b: string | null): string | null {
  const arrA = a ? JSON.parse(a) : [];
  const arrB = b ? JSON.parse(b) : [];
  const merged = [...arrA];
  for (const item of arrB) {
    if (!merged.some((m: { value: string; source: string }) => m.value.toLowerCase() === item.value.toLowerCase() && m.source === item.source)) {
      merged.push(item);
    }
  }
  return merged.length > 0 ? JSON.stringify(merged) : null;
}

const SINGLETON_TABLES = [
  "google_reviews", "trustpilot_reviews", "companies_house_data",
  "marketing_signals", "seo_data", "traffic_data", "installer_scores",
  "google_ads_data",
];
const REASSIGN_TABLES = ["review_items", "activities", "dataforseo_tasks", "keyword_data"];

async function mergePair(idA: number, idB: number): Promise<string> {
  const rows = await sql<InstallerRow[]>`SELECT * FROM installers WHERE id IN (${idA}, ${idB})`;
  const a = rows.find((r) => r.id === idA);
  const b = rows.find((r) => r.id === idB);
  if (!a || !b) return `SKIP: one or both not found (${idA}, ${idB})`;

  // Primary = more populated fields, or lower ID if tied
  const [primary, secondary] = countPopulated(a) >= countPopulated(b) ? [a, b] : [b, a];

  // Build alternative names
  const altParts = [primary.alternative_names, secondary.alternative_names];
  if (secondary.company_name !== primary.company_name) altParts.push(secondary.company_name);
  const altNames = altParts.filter(Boolean).join("; ");

  // Clear secondary's installer_id to avoid unique constraint violations during merge
  if (secondary.installer_id) {
    await sql`UPDATE installers SET installer_id = NULL WHERE id = ${secondary.id}`;
  }

  // Update primary with merged data
  await sql`
    UPDATE installers SET
      email = ${first(primary.email, secondary.email)},
      telephone = ${first(primary.telephone, secondary.telephone)},
      website = ${first(primary.website, secondary.website)},
      address = ${first(primary.address, secondary.address)},
      county = ${first(primary.county, secondary.county)},
      postcode = ${first(primary.postcode, secondary.postcode)},
      country = ${first(primary.country, secondary.country)},
      latitude = ${primary.latitude ?? secondary.latitude},
      longitude = ${primary.longitude ?? secondary.longitude},
      installer_id = ${first(primary.installer_id, secondary.installer_id)},
      certification_number = ${first(primary.certification_number, secondary.certification_number)},
      certification_body = ${first(primary.certification_body, secondary.certification_body)},
      legal_entity_name = ${first(primary.legal_entity_name, secondary.legal_entity_name)},
      legal_entity_number = ${first(primary.legal_entity_number, secondary.legal_entity_number)},
      website_status = ${first(primary.website_status, secondary.website_status)},
      alternative_names = ${altNames || null},
      in_nova = ${primary.in_nova || secondary.in_nova},
      in_mcs = ${primary.in_mcs || secondary.in_mcs},
      in_trustmark = ${primary.in_trustmark || secondary.in_trustmark},
      source_count = ${Math.max(primary.source_count ?? 0, secondary.source_count ?? 0)},
      website_sources = ${mergeSources(primary.website_sources, secondary.website_sources)},
      email_sources = ${mergeSources(primary.email_sources, secondary.email_sources)},
      telephone_sources = ${mergeSources(primary.telephone_sources, secondary.telephone_sources)},
      address_sources = ${mergeSources(primary.address_sources, secondary.address_sources)},
      company_name_sources = ${mergeSources(primary.company_name_sources, secondary.company_name_sources)},
      boiler_upgrade_scheme = ${first(primary.boiler_upgrade_scheme, secondary.boiler_upgrade_scheme)},
      technologies_certified = ${first(primary.technologies_certified, secondary.technologies_certified)},
      regions_covered = ${first(primary.regions_covered, secondary.regions_covered)},
      nova_year_started = ${first(primary.nova_year_started, secondary.nova_year_started)},
      nova_battery_storage = ${first(primary.nova_battery_storage, secondary.nova_battery_storage)},
      nova_location_area = ${first(primary.nova_location_area, secondary.nova_location_area)},
      nova_incorporated_name = ${first(primary.nova_incorporated_name, secondary.nova_incorporated_name)},
      nova_enf_profile_url = ${first(primary.nova_enf_profile_url, secondary.nova_enf_profile_url)},
      trustmark_tmln = ${first(primary.trustmark_tmln, secondary.trustmark_tmln)},
      trustmark_district = ${first(primary.trustmark_district, secondary.trustmark_district)},
      trustmark_region = ${first(primary.trustmark_region, secondary.trustmark_region)},
      trustmark_national_coverage = ${first(primary.trustmark_national_coverage, secondary.trustmark_national_coverage)},
      trustmark_scheme_providers = ${first(primary.trustmark_scheme_providers, secondary.trustmark_scheme_providers)},
      trustmark_member_since = ${first(primary.trustmark_member_since, secondary.trustmark_member_since)},
      trustmark_description = ${first(primary.trustmark_description, secondary.trustmark_description)},
      trustmark_profile_url = ${first(primary.trustmark_profile_url, secondary.trustmark_profile_url)},
      trustmark_status = ${first(primary.trustmark_status, secondary.trustmark_status)},
      pipeline_stage = CASE WHEN ${primary.pipeline_stage} != 'uncontacted' THEN ${primary.pipeline_stage} ELSE ${secondary.pipeline_stage} END,
      updated_at = now()::text
    WHERE id = ${primary.id}
  `;

  // Reassign multi-row tables
  for (const table of REASSIGN_TABLES) {
    await sql.unsafe(`UPDATE ${table} SET installer_id = $1 WHERE installer_id = $2`, [primary.id, secondary.id]);
  }

  // Singleton tables: keep primary's, delete secondary's if primary has one, else reassign
  for (const table of SINGLETON_TABLES) {
    const [existing] = await sql.unsafe(`SELECT id FROM ${table} WHERE installer_id = $1 LIMIT 1`, [primary.id]);
    if (existing) {
      await sql.unsafe(`DELETE FROM ${table} WHERE installer_id = $1`, [secondary.id]);
    } else {
      await sql.unsafe(`UPDATE ${table} SET installer_id = $1 WHERE installer_id = $2`, [primary.id, secondary.id]);
    }
  }

  // Tags
  await sql`
    DELETE FROM installer_tags WHERE installer_id = ${secondary.id}
      AND tag_id IN (SELECT tag_id FROM installer_tags WHERE installer_id = ${primary.id})
  `;
  await sql`UPDATE installer_tags SET installer_id = ${primary.id} WHERE installer_id = ${secondary.id}`;

  // Installer sources — handle potential unique constraint conflicts
  // First delete any from secondary that would conflict with primary's existing sources
  await sql`
    DELETE FROM installer_sources
    WHERE installer_id = ${secondary.id}
      AND (source, source_identifier) IN (
        SELECT source, source_identifier FROM installer_sources WHERE installer_id = ${primary.id}
      )
  `;
  await sql`UPDATE installer_sources SET installer_id = ${primary.id} WHERE installer_id = ${secondary.id}`;

  // Log activity
  await sql`
    INSERT INTO activities (installer_id, type, content, created_at)
    VALUES (${primary.id}, 'note', ${"Merged with \"" + secondary.company_name + "\" (ID: " + secondary.id + "). Secondary record deleted."}, ${new Date().toISOString()})
  `;

  // Delete secondary
  await sql`DELETE FROM installers WHERE id = ${secondary.id}`;

  return `MERGED: "${secondary.company_name}" (${secondary.id}) → "${primary.company_name}" (${primary.id})`;
}

async function main() {
  console.log("=== Duplicate Merge Script ===\n");

  // Step 1: Website fixes
  console.log(`--- Fixing ${WEBSITE_FIXES.length} websites ---`);
  for (const fix of WEBSITE_FIXES) {
    if (fix.website === null) {
      await sql`UPDATE installers SET website = NULL, updated_at = now()::text WHERE id = ${fix.id}`;
      const [row] = await sql<[{ company_name: string }]>`SELECT company_name FROM installers WHERE id = ${fix.id}`;
      console.log(`  Cleared website for ${row?.company_name} (${fix.id})`);
    } else {
      await sql`UPDATE installers SET website = ${fix.website}, updated_at = now()::text WHERE id = ${fix.id}`;
      const [row] = await sql<[{ company_name: string }]>`SELECT company_name FROM installers WHERE id = ${fix.id}`;
      console.log(`  Set website for ${row?.company_name} (${fix.id}) → ${fix.website}`);
    }
  }

  // Step 2: Merges
  console.log(`\n--- Merging ${MERGE_PAIRS.length} duplicate pairs ---`);
  let merged = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < MERGE_PAIRS.length; i++) {
    const [idA, idB] = MERGE_PAIRS[i];
    try {
      const result = await mergePair(idA, idB);
      if (result.startsWith("MERGED")) {
        merged++;
      } else {
        skipped++;
      }
      console.log(`  [${i + 1}/${MERGE_PAIRS.length}] ${result}`);
    } catch (err) {
      errors++;
      console.error(`  [${i + 1}/${MERGE_PAIRS.length}] ERROR merging ${idA}/${idB}:`, (err as Error).message);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Websites fixed: ${WEBSITE_FIXES.length}`);
  console.log(`Pairs merged:   ${merged}`);
  console.log(`Pairs skipped:  ${skipped}`);
  console.log(`Errors:         ${errors}`);

  // Final count
  const [{ count }] = await sql<[{ count: number }]>`SELECT count(*)::int AS count FROM installers`;
  console.log(`\nTotal installers remaining: ${count}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
