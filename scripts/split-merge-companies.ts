/**
 * Split incorrectly merged companies and fix merged records.
 *
 * Usage:
 *   npx tsx scripts/split-merge-companies.ts
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

// ── All enrichment tables with FK to installers.id ──

const SINGLETON_TABLES = [
  "google_reviews", "trustpilot_reviews", "companies_house_data",
  "marketing_signals", "seo_data", "traffic_data", "installer_scores",
  "google_business_info", "google_ads_data", "job_postings", "website_quality",
];
const MULTI_ROW_TABLES = [
  "review_items", "activities", "dataforseo_tasks", "keyword_data",
  "social_signals",
];

// ── Types ──

interface NewRecord {
  companyName: string;
  alternativeNames: string | null;
  postcode: string;
  inNova: boolean;
  inMcs: boolean;
  inTrustMark: boolean;
  sourceCount: number;
  certificationNumber: string | null;
  trustmarkTmln: string | null;
  novaEnfProfileUrl: string | null;
  website: string | null;
  email: string | null;
  telephone: string | null;
  /** Singleton enrichment table names this record should inherit from old record */
  enrichment: string[];
  /** Installer sources to create */
  sources: { source: string; identifier: string; companyName: string; postcode: string }[];
}

interface SplitGroup {
  groupId: string;
  oldId: number;
  records: NewRecord[];
}

interface MergeUpdate {
  groupId: string;
  id: number;
  updates: Record<string, string | number | boolean | null>;
}

// ── SPLIT configurations ──

const SPLITS: SplitGroup[] = [
  {
    groupId: "G001",
    oldId: 2623,
    records: [
      {
        companyName: "Project Better Energy Limited",
        alternativeNames: "Project Better Energy Limited | Project Solar UK | Project Solar UK Ltd | Project Solar UK Limited",
        postcode: "DE13 9PD",
        inNova: true, inMcs: true, inTrustMark: true, sourceCount: 3,
        certificationNumber: "NAP-17166 | NAP-51106",
        trustmarkTmln: "1371245 | 1698305",
        novaEnfProfileUrl: "https://www.enfsolar.com/project-solar-uk",
        website: "https://projectsolaruk.com",
        email: "alan.graham@projectsolaruk.com",
        telephone: "01283 562520",
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NAP-17166 | NAP-51106", companyName: "Project Better Energy Limited", postcode: "DE13 9PD" },
          { source: "enf", identifier: "https://www.enfsolar.com/project-solar-uk", companyName: "Project Better Energy Limited", postcode: "DE13 9PD" },
          { source: "trustmark", identifier: "1371245 | 1698305", companyName: "Project Better Energy Limited", postcode: "DE13 9PD" },
        ],
      },
      {
        companyName: "Graham Energy Solutions UK Ltd",
        alternativeNames: "Graham Energy Solutions UK Ltd | GE Solutions UK",
        postcode: "B61 0AE",
        inNova: true, inMcs: true, inTrustMark: false, sourceCount: 2,
        certificationNumber: "NAP-68144",
        trustmarkTmln: null,
        novaEnfProfileUrl: "https://www.enfsolar.com/ge-solutions-uk",
        website: "https://gesolutionsuk.co.uk",
        email: "info@gesolutionsuk.co.uk",
        telephone: "07887527331",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NAP-68144", companyName: "Graham Energy Solutions UK Ltd", postcode: "B61 0AE" },
          { source: "enf", identifier: "https://www.enfsolar.com/ge-solutions-uk", companyName: "Graham Energy Solutions UK Ltd", postcode: "B61 0AE" },
        ],
      },
    ],
  },
  {
    groupId: "G002",
    oldId: 5583,
    records: [
      {
        companyName: "Pursey & Ball Ltd",
        alternativeNames: "Pursey & Ball Ltd | Pursey & Ball | Pursey and Ball Ltd",
        postcode: "SA13 2PE",
        inNova: true, inMcs: true, inTrustMark: true, sourceCount: 3,
        certificationNumber: "NIC-1596",
        trustmarkTmln: "1740545",
        novaEnfProfileUrl: "https://www.enfsolar.com/pursey-ball",
        website: "https://www.purseyandball.co.uk",
        email: "enquiries@purseyandball.co.uk",
        telephone: "01792 818068",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NIC-1596", companyName: "Pursey & Ball Ltd", postcode: "SA13 2PE" },
          { source: "enf", identifier: "https://www.enfsolar.com/pursey-ball", companyName: "Pursey & Ball Ltd", postcode: "SA13 2PE" },
          { source: "trustmark", identifier: "1740545", companyName: "Pursey & Ball Ltd", postcode: "SA13 2PE" },
        ],
      },
      {
        companyName: "Solarcentric Renewables Ltd",
        alternativeNames: "Solarcentric Renewables Ltd | SolarCentric | Solarcentric Ltd",
        postcode: "SA13 2PE",
        inNova: true, inMcs: true, inTrustMark: true, sourceCount: 3,
        certificationNumber: "NIC-5981",
        trustmarkTmln: "4024121",
        novaEnfProfileUrl: "https://www.enfsolar.com/solarcentric",
        website: "https://solarcentric.co.uk",
        email: "john@solarcentric.co.uk",
        telephone: null,
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NIC-5981", companyName: "Solarcentric Renewables Ltd", postcode: "SA13 2PE" },
          { source: "enf", identifier: "https://www.enfsolar.com/solarcentric", companyName: "Solarcentric Renewables Ltd", postcode: "SA13 2PE" },
          { source: "trustmark", identifier: "4024121", companyName: "Solarcentric Renewables Ltd", postcode: "SA13 2PE" },
        ],
      },
    ],
  },
  {
    groupId: "G003",
    oldId: 772,
    records: [
      {
        companyName: "Big Easy Services Limited",
        alternativeNames: "Big Easy Services Limited | BIG EASY SERVICES LTD",
        postcode: "M8 5EQ",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "IAA-10014",
        trustmarkTmln: "3029328",
        novaEnfProfileUrl: null,
        website: null,
        email: "mustu69@hotmail.com",
        telephone: "07722500975",
        enrichment: ["google_reviews", "companies_house_data"],
        sources: [
          { source: "mcs", identifier: "IAA-10014", companyName: "Big Easy Services Limited", postcode: "M8 5EQ" },
          { source: "trustmark", identifier: "3029328", companyName: "Big Easy Services Limited", postcode: "M8 5EQ" },
        ],
      },
      {
        companyName: "Eco Planet Global Ltd",
        alternativeNames: "Eco Planet Global Ltd",
        postcode: "M50 2QL",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "IAA-10278",
        trustmarkTmln: "4028726 | 4115211",
        novaEnfProfileUrl: null,
        website: "www.ecoplanetglobal.com",
        email: "info@ecoplanetgloballtd.com",
        telephone: "07775985854",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "IAA-10278", companyName: "Eco Planet Global Ltd", postcode: "M50 2QL" },
          { source: "trustmark", identifier: "4028726 | 4115211", companyName: "Eco Planet Global Ltd", postcode: "M50 2QL" },
        ],
      },
    ],
  },
  {
    groupId: "G004",
    oldId: 2116,
    records: [
      {
        companyName: "Energy Hub (South Wales) Limited ta OVO Solar and Heating South Wales",
        alternativeNames: "Energy Hub (South Wales) Limited ta OVO Solar and Heating South Wales",
        postcode: "NP13 1SP",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NIC-602208",
        trustmarkTmln: "3957428",
        novaEnfProfileUrl: null,
        website: "http://www.energyhubwales.co.uk",
        email: "info@energyhubwales.co.uk",
        telephone: "01495371321",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NIC-602208", companyName: "Energy Hub (South Wales) Limited ta OVO Solar and Heating South Wales", postcode: "NP13 1SP" },
          { source: "trustmark", identifier: "3957428", companyName: "Energy Hub (South Wales) Limited ta OVO Solar and Heating South Wales", postcode: "NP13 1SP" },
        ],
      },
      {
        companyName: "Gas Tech Wales Ltd",
        alternativeNames: "Gas Tech Wales Ltd",
        postcode: "NP13 1SP",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NIC-600078",
        trustmarkTmln: "1733519",
        novaEnfProfileUrl: null,
        website: "www.gastechwales.co.uk",
        email: "info@gastechwales.co.uk",
        telephone: null,
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NIC-600078", companyName: "Gas Tech Wales Ltd", postcode: "NP13 1SP" },
          { source: "trustmark", identifier: "1733519", companyName: "Gas Tech Wales Ltd", postcode: "NP13 1SP" },
        ],
      },
    ],
  },
  {
    groupId: "G007",
    oldId: 6079,
    records: [
      {
        companyName: "Hinckley Plumbing and Heating Services Limited",
        alternativeNames: "Hinckley Plumbing and Heating Services Limited",
        postcode: "LE10 3BE",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NAP-71653",
        trustmarkTmln: "3366526",
        novaEnfProfileUrl: null,
        website: "https://www.hinckleyplumbing.co.uk",
        email: null,
        telephone: "01455632030",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NAP-71653", companyName: "Hinckley Plumbing and Heating Services Limited", postcode: "LE10 3BE" },
          { source: "trustmark", identifier: "3366526", companyName: "Hinckley Plumbing and Heating Services Limited", postcode: "LE10 3BE" },
        ],
      },
      {
        companyName: "The Green Deal Factory Ltd t/a Clever Energy Boilers",
        alternativeNames: "The Green Deal Factory Ltd t/a Clever Energy Boilers | The Green Deal Factory Ltd",
        postcode: "BD16 1PE",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NAP-217801",
        trustmarkTmln: "1734609",
        novaEnfProfileUrl: null,
        website: "www.cleverenergyboilers.co.uk",
        email: "tim@cleverenergyboilers.co.uk",
        telephone: "01274214557",
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NAP-217801", companyName: "The Green Deal Factory Ltd t/a Clever Energy Boilers", postcode: "BD16 1PE" },
          { source: "trustmark", identifier: "1734609", companyName: "The Green Deal Factory Ltd t/a Clever Energy Boilers", postcode: "BD16 1PE" },
        ],
      },
    ],
  },
  {
    groupId: "G008",
    oldId: 6116,
    records: [
      {
        companyName: "Stark Electrical Contractors Ltd",
        alternativeNames: "Stark Electrical Contractors Ltd",
        postcode: "NP22 3DT",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NIC-601219",
        trustmarkTmln: "3936945",
        novaEnfProfileUrl: null,
        website: "https://starkelectrical.co.uk/",
        email: "luke@starkelectrical.co.uk",
        telephone: "07376674638",
        // Website-based enrichment was for starkelectrical.co.uk
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NIC-601219", companyName: "Stark Electrical Contractors Ltd", postcode: "NP22 3DT" },
          { source: "trustmark", identifier: "3936945", companyName: "Stark Electrical Contractors Ltd", postcode: "NP22 3DT" },
        ],
      },
      {
        companyName: "The Solar House Ltd (England & Wales)",
        alternativeNames: "The Solar House Ltd (England & Wales)",
        postcode: "CF14 2AA",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NIC-200098",
        trustmarkTmln: "4073526",
        novaEnfProfileUrl: null,
        website: "http://www.thesolarhouse.co.uk",
        email: "luke@thesolarhouse.co.uk",
        telephone: null,
        // Google reviews searched by "The Solar House Ltd" name
        enrichment: ["google_reviews"],
        sources: [
          { source: "mcs", identifier: "NIC-200098", companyName: "The Solar House Ltd (England & Wales)", postcode: "CF14 2AA" },
          { source: "trustmark", identifier: "4073526", companyName: "The Solar House Ltd (England & Wales)", postcode: "CF14 2AA" },
        ],
      },
    ],
  },
  {
    groupId: "G009",
    oldId: 6401,
    records: [
      {
        companyName: "Warm Homes Energy Group Ltd t/a Warm Homes Energy Group",
        alternativeNames: "Warm Homes Energy Group Ltd t/a Warm Homes Energy Group | Warm Homes Energy Group Ltd",
        postcode: "LL32 8JL",
        inNova: false, inMcs: true, inTrustMark: true, sourceCount: 2,
        certificationNumber: "NAP-76443",
        trustmarkTmln: "3731939",
        novaEnfProfileUrl: null,
        website: "https://www.warmhomesenergygroup.co.uk/",
        email: "info@warmhomesgroup.co.uk",
        telephone: "07710050223",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NAP-76443", companyName: "Warm Homes Energy Group Ltd t/a Warm Homes Energy Group", postcode: "LL32 8JL" },
          { source: "trustmark", identifier: "3731939", companyName: "Warm Homes Energy Group Ltd t/a Warm Homes Energy Group", postcode: "LL32 8JL" },
        ],
      },
      {
        companyName: "Indigo Eco Solutions Ltd",
        alternativeNames: "Indigo Eco Solutions Ltd",
        postcode: "WA7 4UH",
        inNova: false, inMcs: false, inTrustMark: true, sourceCount: 1,
        certificationNumber: null,
        trustmarkTmln: "3230508",
        novaEnfProfileUrl: null,
        website: null,
        email: null,
        telephone: null,
        enrichment: [],
        sources: [
          { source: "trustmark", identifier: "3230508", companyName: "Indigo Eco Solutions Ltd", postcode: "WA7 4UH" },
        ],
      },
    ],
  },
  {
    groupId: "G010",
    oldId: 1009,
    records: [
      {
        companyName: "BTG Electrical Limited",
        alternativeNames: "BTG Electrical Limited",
        postcode: "ST3 1NB",
        inNova: false, inMcs: true, inTrustMark: false, sourceCount: 1,
        certificationNumber: "NAP-15866",
        trustmarkTmln: null,
        novaEnfProfileUrl: null,
        website: null,
        email: "Dbefltd@yahoo.com",
        telephone: null,
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NAP-15866", companyName: "BTG Electrical Limited", postcode: "ST3 1NB" },
        ],
      },
      {
        companyName: "Capri Electrical Ltd T/A Capri Electrical",
        alternativeNames: "Capri Electrical Ltd T/A Capri Electrical",
        postcode: "ST3 7QT",
        inNova: false, inMcs: true, inTrustMark: false, sourceCount: 1,
        certificationNumber: "NAP-78803",
        trustmarkTmln: null,
        novaEnfProfileUrl: null,
        website: null,
        email: "caprielectrical@outlook.com",
        telephone: "07969776617",
        // Companies House found CAPRI ELECTRICAL LTD
        enrichment: ["companies_house_data", "marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NAP-78803", companyName: "Capri Electrical Ltd T/A Capri Electrical", postcode: "ST3 7QT" },
        ],
      },
    ],
  },
  {
    groupId: "G011",
    oldId: 4559,
    records: [
      {
        companyName: "EV & Solar Solutions Ltd",
        alternativeNames: "EV & Solar Solutions Ltd",
        postcode: "SA18 2EH",
        inNova: false, inMcs: true, inTrustMark: false, sourceCount: 1,
        certificationNumber: "NIC-601762",
        trustmarkTmln: null,
        novaEnfProfileUrl: null,
        website: "evsolarsolutions.co.uk",
        email: "info@evsolarsolutions.co.uk",
        telephone: "07872323980",
        enrichment: ["marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NIC-601762", companyName: "EV & Solar Solutions Ltd", postcode: "SA18 2EH" },
        ],
      },
      {
        companyName: "Phase Connections Limited",
        alternativeNames: "Phase Connections Limited",
        postcode: "SA18 3TN",
        inNova: false, inMcs: true, inTrustMark: false, sourceCount: 1,
        certificationNumber: "NIC-601408",
        trustmarkTmln: null,
        novaEnfProfileUrl: null,
        website: null,
        email: "chris@phaseconnections.co.uk",
        telephone: null,
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NIC-601408", companyName: "Phase Connections Limited", postcode: "SA18 3TN" },
        ],
      },
    ],
  },
  {
    groupId: "G012",
    oldId: 4602,
    records: [
      {
        companyName: "ELEC-UK LTD",
        alternativeNames: "ELEC-UK LTD",
        postcode: "RG24 8TH",
        inNova: false, inMcs: true, inTrustMark: false, sourceCount: 1,
        certificationNumber: "NIC-601454",
        trustmarkTmln: null,
        novaEnfProfileUrl: null,
        website: null,
        email: "richard.buckland@elecuk.co.uk",
        telephone: "07500662913",
        enrichment: [],
        sources: [
          { source: "mcs", identifier: "NIC-601454", companyName: "ELEC-UK LTD", postcode: "RG24 8TH" },
        ],
      },
      {
        companyName: "Plectrumb Ltd",
        alternativeNames: "Plectrumb Ltd",
        postcode: "EX7 0NH",
        inNova: false, inMcs: true, inTrustMark: false, sourceCount: 1,
        certificationNumber: "NIC-600497",
        trustmarkTmln: null,
        novaEnfProfileUrl: null,
        website: "www.plectrumb.co.uk",
        email: null,
        telephone: "07752502791",
        // Trustpilot is for plectrumb.co.uk, website enrichment was for plectrumb.co.uk
        enrichment: ["trustpilot_reviews", "marketing_signals", "traffic_data", "website_quality"],
        sources: [
          { source: "mcs", identifier: "NIC-600497", companyName: "Plectrumb Ltd", postcode: "EX7 0NH" },
        ],
      },
    ],
  },
];

// ── MERGE-UPDATE configurations (already merged, just fix fields) ──

const MERGE_UPDATES: MergeUpdate[] = [
  {
    groupId: "G005",
    id: 3167,
    updates: {
      source_count: 3,
      alternative_names: "Integrity Energy Solutions Limited | Integrity Energy Solutions | Integrity Energy Solutions Ltd",
    },
  },
  {
    groupId: "G006",
    id: 5850,
    updates: {
      postcode: "EX5 4BL",
      source_count: 3,
      alternative_names: "Sunflower Energy Solutions Ltd | Sunflower Energy Solutions",
      website: "https://www.sunflowernrg.co.uk",
    },
  },
];

// ── Processing logic ──

async function processSplit(group: SplitGroup): Promise<string> {
  const { groupId, oldId, records } = group;

  // Verify old record exists
  const [old] = await sql`SELECT id, company_name FROM installers WHERE id = ${oldId}`;
  if (!old) return `${groupId}: SKIP — old record ID ${oldId} not found`;

  const now = new Date().toISOString();
  const newIds: number[] = [];

  // 1. Insert new records
  for (const rec of records) {
    const [inserted] = await sql`
      INSERT INTO installers (
        company_name, alternative_names, postcode,
        in_nova, in_mcs, in_trustmark, source_count,
        certification_number, trustmark_tmln, nova_enf_profile_url,
        website, email, telephone,
        pipeline_stage, created_at, updated_at
      ) VALUES (
        ${rec.companyName}, ${rec.alternativeNames}, ${rec.postcode},
        ${rec.inNova}, ${rec.inMcs}, ${rec.inTrustMark}, ${rec.sourceCount},
        ${rec.certificationNumber}, ${rec.trustmarkTmln}, ${rec.novaEnfProfileUrl},
        ${rec.website}, ${rec.email}, ${rec.telephone},
        'uncontacted', ${now}, ${now}
      ) RETURNING id
    `;
    newIds.push(inserted.id);
    console.log(`  Created "${rec.companyName}" → ID ${inserted.id}`);
  }

  // 2. Reassign enrichment from old record to new records
  // Build a map: table name → new record ID
  const enrichmentMap: Record<string, number> = {};
  for (let i = 0; i < records.length; i++) {
    for (const table of records[i].enrichment) {
      enrichmentMap[table] = newIds[i];
    }
  }

  // For each singleton table: reassign if mapped, otherwise delete
  for (const table of SINGLETON_TABLES) {
    const [existing] = await sql.unsafe(
      `SELECT id FROM ${table} WHERE installer_id = $1 LIMIT 1`,
      [oldId]
    );
    if (existing) {
      if (enrichmentMap[table]) {
        await sql.unsafe(
          `UPDATE ${table} SET installer_id = $1 WHERE installer_id = $2`,
          [enrichmentMap[table], oldId]
        );
        console.log(`  Moved ${table} → ID ${enrichmentMap[table]}`);
      } else {
        await sql.unsafe(`DELETE FROM ${table} WHERE installer_id = $1`, [oldId]);
        console.log(`  Deleted ${table} for old ID ${oldId}`);
      }
    }
  }

  // 3. Delete multi-row child records (activities, review_items, etc.)
  for (const table of MULTI_ROW_TABLES) {
    const result = await sql.unsafe(
      `DELETE FROM ${table} WHERE installer_id = $1`,
      [oldId]
    );
    if (result.count > 0) {
      console.log(`  Deleted ${result.count} rows from ${table}`);
    }
  }

  // 4. Delete old installer_sources and installer_tags
  await sql`DELETE FROM installer_sources WHERE installer_id = ${oldId}`;
  await sql`DELETE FROM installer_tags WHERE installer_id = ${oldId}`;

  // 5. Create new installer_sources
  for (let i = 0; i < records.length; i++) {
    for (const src of records[i].sources) {
      await sql`
        INSERT INTO installer_sources (installer_id, source, source_identifier, source_company_name, source_postcode, imported_at)
        VALUES (${newIds[i]}, ${src.source}, ${src.identifier}, ${src.companyName}, ${src.postcode}, ${now})
        ON CONFLICT (source, source_identifier) DO UPDATE SET
          installer_id = EXCLUDED.installer_id,
          source_company_name = EXCLUDED.source_company_name,
          source_postcode = EXCLUDED.source_postcode
      `;
    }
  }

  // 6. Delete old installer record
  await sql`DELETE FROM installers WHERE id = ${oldId}`;
  console.log(`  Deleted old record "${old.company_name}" (ID ${oldId})`);

  return `${groupId}: SPLIT "${old.company_name}" (${oldId}) → ${records.map((r, i) => `"${r.companyName}" (${newIds[i]})`).join(" + ")}`;
}

async function processMergeUpdate(mu: MergeUpdate): Promise<string> {
  const { groupId, id, updates } = mu;

  const [existing] = await sql`SELECT id, company_name FROM installers WHERE id = ${id}`;
  if (!existing) return `${groupId}: SKIP — record ID ${id} not found`;

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  let paramIdx = 1;

  for (const [col, val] of Object.entries(updates)) {
    setClauses.push(`${col} = $${paramIdx}`);
    values.push(val);
    paramIdx++;
  }
  setClauses.push(`updated_at = $${paramIdx}`);
  values.push(new Date().toISOString());
  paramIdx++;

  values.push(id);
  await sql.unsafe(
    `UPDATE installers SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
    values
  );

  return `${groupId}: UPDATED "${existing.company_name}" (${id}) — fields: ${Object.keys(updates).join(", ")}`;
}

async function main() {
  console.log("=== Company Split/Merge Script ===\n");

  // Process splits
  console.log(`--- Processing ${SPLITS.length} SPLIT groups ---\n`);
  let splitOk = 0, splitErr = 0;
  for (const group of SPLITS) {
    try {
      console.log(`[${group.groupId}] Splitting ID ${group.oldId}...`);
      const result = await processSplit(group);
      console.log(`  ✓ ${result}\n`);
      splitOk++;
    } catch (err) {
      console.error(`  ✗ ${group.groupId} ERROR:`, (err as Error).message, "\n");
      splitErr++;
    }
  }

  // Process merge-updates
  console.log(`\n--- Processing ${MERGE_UPDATES.length} MERGE-UPDATE groups ---\n`);
  let mergeOk = 0, mergeErr = 0;
  for (const mu of MERGE_UPDATES) {
    try {
      const result = await processMergeUpdate(mu);
      console.log(`  ✓ ${result}`);
      mergeOk++;
    } catch (err) {
      console.error(`  ✗ ${mu.groupId} ERROR:`, (err as Error).message);
      mergeErr++;
    }
  }

  // Summary
  const [{ count }] = await sql<[{ count: number }]>`SELECT count(*)::int AS count FROM installers`;
  console.log("\n=== Summary ===");
  console.log(`Splits:        ${splitOk} ok, ${splitErr} errors`);
  console.log(`Merge-updates: ${mergeOk} ok, ${mergeErr} errors`);
  console.log(`Total installers: ${count}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
