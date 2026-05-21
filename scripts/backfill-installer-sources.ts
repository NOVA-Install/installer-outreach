/**
 * Backfill installer_sources from existing installer data.
 *
 * Usage:
 *   npx tsx scripts/backfill-installer-sources.ts
 *
 * Reads DATABASE_URL from .env.local
 */

import { config } from "dotenv";
import postgres from "postgres";

// Load .env.local
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Check .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 3 });

interface InstallerRow {
  id: number;
  company_name: string;
  postcode: string | null;
  installer_id: string | null;
  in_mcs: boolean | null;
  in_nova: boolean | null;
  in_trustmark: boolean | null;
  nova_enf_profile_url: string | null;
  trustmark_tmln: string | null;
}

async function backfill() {
  console.log("Fetching all installers...");
  const installers = await sql<InstallerRow[]>`
    SELECT id, company_name, postcode, installer_id,
           in_mcs, in_nova, in_trustmark,
           nova_enf_profile_url, trustmark_tmln
    FROM installers
  `;

  console.log(`Found ${installers.length} installers`);

  let mcsCount = 0;
  let enfCount = 0;
  let trustmarkCount = 0;
  let skipped = 0;

  for (const inst of installers) {
    // --- MCS source ---
    if (inst.in_mcs || inst.installer_id) {
      const sourceIdentifier = inst.installer_id;
      if (sourceIdentifier) {
        try {
          await sql`
            INSERT INTO installer_sources (installer_id, source, source_identifier, source_company_name, source_postcode)
            VALUES (${inst.id}, 'mcs', ${sourceIdentifier}, ${inst.company_name}, ${inst.postcode})
            ON CONFLICT (source, source_identifier) DO NOTHING
          `;
          mcsCount++;
        } catch (err) {
          console.error(`MCS insert error for installer ${inst.id}:`, err);
        }
      } else {
        // in_mcs=true but no installer_id: use composite key
        const composite = `${inst.company_name}|${inst.postcode || ""}`;
        try {
          await sql`
            INSERT INTO installer_sources (installer_id, source, source_identifier, source_company_name, source_postcode)
            VALUES (${inst.id}, 'mcs', ${composite}, ${inst.company_name}, ${inst.postcode})
            ON CONFLICT (source, source_identifier) DO NOTHING
          `;
          mcsCount++;
        } catch (err) {
          console.error(`MCS composite insert error for installer ${inst.id}:`, err);
        }
      }
    }

    // --- ENF/Nova source ---
    if (inst.in_nova || inst.nova_enf_profile_url) {
      const sourceIdentifier =
        inst.nova_enf_profile_url ||
        `${inst.company_name}|${inst.postcode || ""}`;
      try {
        await sql`
          INSERT INTO installer_sources (installer_id, source, source_identifier, source_company_name, source_postcode)
          VALUES (${inst.id}, 'enf', ${sourceIdentifier}, ${inst.company_name}, ${inst.postcode})
          ON CONFLICT (source, source_identifier) DO NOTHING
        `;
        enfCount++;
      } catch (err) {
        console.error(`ENF insert error for installer ${inst.id}:`, err);
      }
    }

    // --- TrustMark source ---
    if (inst.in_trustmark || inst.trustmark_tmln) {
      const sourceIdentifier =
        inst.trustmark_tmln ||
        `${inst.company_name}|${inst.postcode || ""}`;
      try {
        await sql`
          INSERT INTO installer_sources (installer_id, source, source_identifier, source_company_name, source_postcode)
          VALUES (${inst.id}, 'trustmark', ${sourceIdentifier}, ${inst.company_name}, ${inst.postcode})
          ON CONFLICT (source, source_identifier) DO NOTHING
        `;
        trustmarkCount++;
      } catch (err) {
        console.error(`TrustMark insert error for installer ${inst.id}:`, err);
      }
    }
  }

  console.log("\n--- Backfill Summary ---");
  console.log(`MCS rows inserted:       ${mcsCount}`);
  console.log(`ENF rows inserted:       ${enfCount}`);
  console.log(`TrustMark rows inserted: ${trustmarkCount}`);
  console.log(`Total:                   ${mcsCount + enfCount + trustmarkCount}`);

  // Verify
  const [{ count }] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM installer_sources
  `;
  console.log(`\nTotal rows in installer_sources: ${count}`);

  await sql.end();
  process.exit(0);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
