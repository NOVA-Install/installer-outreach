/**
 * Import HubSpot deal data into the CRM:
 * - Update pipeline stages for matched installers
 * - Import notes as activities with spread timestamps
 *
 * Usage: npx tsx scripts/hubspot-import.ts [--dry-run]
 *        npx tsx scripts/hubspot-import.ts --cleanup  (delete previously imported)
 */
import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "fs";
import Papa from "papaparse";

config({ path: ".env.local" });
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = postgres(DATABASE_URL, { prepare: false, max: 3 });

const DRY_RUN = process.argv.includes("--dry-run");
const CLEANUP = process.argv.includes("--cleanup");

const CSV_PATH = "/Users/chris/Library/Application Support/Claude/local-agent-mode-sessions/afafca88-b212-4095-870c-95d4b6b6ec0d/ee1d94fa-1c0f-41cd-bb34-28f926b2a6d5/local_831ce2b2-fb2f-4645-8476-5fd6f7359d9d/outputs/hubspot-crm-exports-all-deals-2026-05-06-cleaned.csv";

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^\w\s&]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(ltd|limited|plc|llp)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MANUAL_MATCHES: Record<string, number> = {
  "Stellar Energy": 5790,
  "Nano Pro Tech Ltd": 4187,
  "Unclouded solar": 6291,
  "Heatpac": 4041,
  "Golden Globe Ltd": 2601,
  "1st Call Gas": 57,
  "SimplexEco": 5334,
  "Boiler Genie": 2482,
  "Arktek": 537,
  "All Eco UK": 376,
  "Eko Build": 1928,
  "Retro Renewables (Verde Power)": 5019,
  "JDS Energy": 3342,
  "Improveasy": 3116,
  "Easy Build Solutions": 1711,
  "Bluebuild Insulation Ltd": 798,
  "Macbrook Gas": 3875,
  "0800": 4578,
  "Legacy Eco Ltd": 3665,
  "Eco Giants": 1909,
  "DVC": 1645,
  "Next Energy UK": 4250,
};

function mapStage(hsStage: string): string {
  const map: Record<string, string> = {
    "Installer identified": "target",
    "Intro call": "contacted",
    "Qualifying call": "first_meeting",
    "Decision Maker Call": "first_meeting",
    "Contract Sent": "proposal",
    "Closed Won": "won",
    "Closed Lost": "lost",
  };
  return map[hsStage] || "uncontacted";
}

function mapPriority(hsPriority: string): number | null {
  const map: Record<string, number> = { "High": 1, "Medium": 3, "Low": 5 };
  return map[hsPriority] || null;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Spread N items evenly between start and end, returning ISO strings */
function spreadTimestamps(start: Date, end: Date, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [start.toISOString()];
  const startMs = start.getTime();
  const endMs = Math.max(end.getTime(), startMs + count * 60_000); // at least 1 min apart
  const step = (endMs - startMs) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    new Date(startMs + Math.round(step * i)).toISOString()
  );
}

async function cleanup() {
  const result = await sql`DELETE FROM activities WHERE metadata::text LIKE '%"source":"hubspot"%'`;
  console.log(`Deleted ${result.count} hubspot-imported activities`);
  await sql.end();
}

async function main() {
  if (CLEANUP) return cleanup();

  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const { data: records } = Papa.parse(csvContent, { header: true, skipEmptyLines: true }) as { data: Record<string, string>[] };

  const installers = await sql`SELECT id, company_name FROM installers`;
  const dbByNorm = new Map<string, number>();
  for (const i of installers) {
    dbByNorm.set(normalize(i.company_name), i.id);
  }

  let stageUpdates = 0;
  let notesImported = 0;
  let priorityUpdates = 0;
  let skipped = 0;
  const seen = new Set<string>();

  for (const row of records) {
    const dealName = (row["Deal Name"] || "").trim();
    if (!dealName) continue;

    const stage = (row["Deal Stage"] || "").trim();
    const notes = (row["Associated Note"] || "").trim();
    const priority = (row["Priority"] || "").trim();
    const closedReason = (row["Closed Lost Reason"] || "").trim();
    const createDate = (row["Create Date"] || "").trim();
    const lastActivityDate = (row["Last Activity Date"] || "").trim();
    const lastModifiedDate = (row["Last Modified Date"] || "").trim();

    let dbId: number | undefined;
    if (MANUAL_MATCHES[dealName]) {
      dbId = MANUAL_MATCHES[dealName];
    } else {
      dbId = dbByNorm.get(normalize(dealName));
    }

    if (!dbId) { skipped++; continue; }

    const dedupeKey = `${dbId}`;
    if (seen.has(dedupeKey)) {
      // Duplicate row (e.g. Optama) — add notes with current timestamps
      if (notes) {
        const notesList = notes.split(";").map(n => n.trim()).filter(n => n.length >= 3 && !/^\d+$/.test(n));
        for (const noteText of notesList) {
          if (!DRY_RUN) {
            await sql`
              INSERT INTO activities (installer_id, type, content, metadata, created_at)
              VALUES (${dbId}, 'note', ${noteText}, ${JSON.stringify({ source: "hubspot", dealName, stage })}, ${new Date().toISOString()})
            `;
          }
          notesImported++;
        }
      }
      continue;
    }
    seen.add(dedupeKey);

    const crmStage = mapStage(stage);
    const crmPriority = mapPriority(priority);

    // 1. Update pipeline stage + priority
    if (!DRY_RUN) {
      await sql`
        UPDATE installers
        SET pipeline_stage = ${crmStage},
            pipeline_stage_updated_at = ${new Date().toISOString()},
            updated_at = ${new Date().toISOString()}
        WHERE id = ${dbId}
      `;
      if (crmPriority !== null) {
        await sql`
          UPDATE installers
          SET priority = ${crmPriority}
          WHERE id = ${dbId} AND (priority IS NULL)
        `;
        priorityUpdates++;
      }
    }
    stageUpdates++;
    console.log(`  [${dbId}] ${dealName} → stage: ${crmStage}${crmPriority ? `, priority: ${crmPriority}` : ""}`);

    // 2. Import activities — use deal create date from HubSpot
    const activityDate = createDate || new Date().toISOString();

    // Stage change
    const stageChangeMeta: Record<string, string> = { source: "hubspot", hubspotStage: stage, dealName };
    if (closedReason) stageChangeMeta.closedReason = closedReason;
    if (!DRY_RUN) {
      await sql`
        INSERT INTO activities (installer_id, type, content, metadata, created_at)
        VALUES (${dbId}, 'stage_change', ${`Pipeline stage set to "${crmStage}" (imported from HubSpot: "${stage}")`}, ${JSON.stringify(stageChangeMeta)}, ${activityDate})
      `;
    }

    // Notes
    if (notes) {
      const notesList = notes.split(";").map(n => n.trim()).filter(n => n.length >= 3 && !/^\d+$/.test(n));
      for (const noteText of notesList) {
        if (!DRY_RUN) {
          await sql`
            INSERT INTO activities (installer_id, type, content, metadata, created_at)
            VALUES (${dbId}, 'note', ${noteText}, ${JSON.stringify({ source: "hubspot", dealName, stage })}, ${activityDate})
          `;
        }
        notesImported++;
      }
    }

    // Closed lost reason
    if (closedReason && stage === "Closed Lost") {
      if (!DRY_RUN) {
        await sql`
          INSERT INTO activities (installer_id, type, content, metadata, created_at)
          VALUES (${dbId}, 'note', ${"Closed Lost Reason: " + closedReason}, ${JSON.stringify({ source: "hubspot", dealName })}, ${activityDate})
        `;
      }
      notesImported++;
    }
  }

  console.log(`\n=== ${DRY_RUN ? "DRY RUN " : ""}IMPORT COMPLETE ===`);
  console.log(`  Stage updates: ${stageUpdates}`);
  console.log(`  Priority updates: ${priorityUpdates}`);
  console.log(`  Notes imported: ${notesImported}`);
  console.log(`  Skipped (unmatched): ${skipped}`);

  await sql.end();
}

main().catch(console.error);
