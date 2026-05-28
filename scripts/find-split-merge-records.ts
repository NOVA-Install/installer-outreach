/**
 * Find all records affected by the split/merge change list.
 * Read-only — no modifications.
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

async function main() {
  // Search by company name patterns
  const patterns = [
    "%Graham Energy Solutions UK Ltd%",
    "%Project Better Energy%",
    "%Project Solar UK%",
    "%GE Solutions UK%",
    "%Solarcentric%",
    "%Pursey%Ball%",
    "%Big Easy Services%",
    "%Eco Planet Global%",
    "%Energy Hub (South Wales)%",
    "%Gas Tech Wales%",
    "%Integrity Energy Solutions%",
    "%Sunflower Energy Solutions%",
    "%Green Deal Factory%",
    "%Clever Energy Boilers%",
    "%Hinckley Plumbing%",
    "%Solar House Ltd%",
    "%Stark Electrical%",
    "%Warm Homes Energy Group%",
    "%Indigo Eco Solutions%",
    "%Capri Electrical%",
    "%BTG Electrical%",
    "%Phase Connections%",
    "%EV & Solar Solutions%",
    "%Plectrumb%",
    "%ELEC-UK%",
  ];

  const rows = await sql`
    SELECT i.id, i.company_name, i.alternative_names, i.postcode,
           i.in_nova, i.in_mcs, i.in_trustmark, i.source_count,
           i.certification_number, i.trustmark_tmln, i.nova_enf_profile_url,
           i.website, i.pipeline_stage, i.is_shortlisted, i.priority,
           i.website_sources, i.email, i.telephone
    FROM installers i
    WHERE i.company_name ILIKE ANY(${patterns})
       OR i.alternative_names ILIKE ANY(${patterns})
    ORDER BY i.company_name
  `;

  console.log(`Found ${rows.length} matching records:\n`);

  for (const r of rows) {
    console.log(`--- ID ${r.id} ---`);
    console.log(`  Name: ${r.company_name}`);
    console.log(`  Alt names: ${r.alternative_names || "(none)"}`);
    console.log(`  Postcode: ${r.postcode}`);
    console.log(`  Sources: nova=${r.in_nova} mcs=${r.in_mcs} tm=${r.in_trustmark} count=${r.source_count}`);
    console.log(`  MCS cert: ${r.certification_number || "(none)"}`);
    console.log(`  TMLN: ${r.trustmark_tmln || "(none)"}`);
    console.log(`  ENF URL: ${r.nova_enf_profile_url || "(none)"}`);
    console.log(`  Website: ${r.website || "(none)"}`);
    console.log(`  Email: ${r.email || "(none)"}`);
    console.log(`  Phone: ${r.telephone || "(none)"}`);
    console.log(`  Pipeline: ${r.pipeline_stage}  Shortlisted: ${r.is_shortlisted}  Priority: ${r.priority}`);
    console.log();
  }

  // Also check enrichment data for these IDs
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    console.log("=== Enrichment data status ===\n");
    const enrichmentTables = [
      "google_reviews", "trustpilot_reviews", "companies_house_data",
      "marketing_signals", "seo_data", "traffic_data", "installer_scores",
      "google_business_info", "google_ads_data", "job_postings",
      "website_quality", "linkedin_company_tracking",
    ];

    for (const table of enrichmentTables) {
      const enriched = await sql.unsafe(
        `SELECT installer_id FROM ${table} WHERE installer_id = ANY($1)`,
        [ids]
      );
      if (enriched.length > 0) {
        console.log(`${table}: has data for IDs ${enriched.map((r: any) => r.installer_id).join(", ")}`);
      }
    }

    // Check installer_sources
    const sources = await sql`
      SELECT installer_id, source, source_identifier, source_company_name
      FROM installer_sources
      WHERE installer_id = ANY(${ids})
      ORDER BY installer_id, source
    `;
    console.log(`\n=== Installer sources (${sources.length} rows) ===\n`);
    for (const s of sources) {
      console.log(`  ID ${s.installer_id}: [${s.source}] ${s.source_identifier} — ${s.source_company_name}`);
    }

    // Check multi-row tables
    const activities = await sql`SELECT installer_id, count(*)::int as cnt FROM activities WHERE installer_id = ANY(${ids}) GROUP BY installer_id`;
    if (activities.length > 0) {
      console.log(`\n=== Activities ===`);
      for (const a of activities) {
        console.log(`  ID ${a.installer_id}: ${a.cnt} activities`);
      }
    }

    const tags = await sql`SELECT it.installer_id, t.name FROM installer_tags it JOIN tags t ON t.id = it.tag_id WHERE it.installer_id = ANY(${ids})`;
    if (tags.length > 0) {
      console.log(`\n=== Tags ===`);
      for (const t of tags) {
        console.log(`  ID ${t.installer_id}: ${t.name}`);
      }
    }

    const social = await sql`SELECT installer_id, count(*)::int as cnt FROM social_signals WHERE installer_id = ANY(${ids}) GROUP BY installer_id`;
    if (social.length > 0) {
      console.log(`\n=== Social signals ===`);
      for (const s of social) {
        console.log(`  ID ${s.installer_id}: ${s.cnt} signals`);
      }
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
