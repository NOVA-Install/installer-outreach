/**
 * Deep cross-reference: match unmatched HubSpot deals by domain, phone, email, and fuzzy name
 * Usage: npx tsx scripts/hubspot-match.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "fs";
import Papa from "papaparse";

config({ path: ".env.local" });
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = postgres(DATABASE_URL, { prepare: false, max: 3 });

const CSV_PATH = "/Users/chris/Library/Application Support/Claude/local-agent-mode-sessions/afafca88-b212-4095-870c-95d4b6b6ec0d/ee1d94fa-1c0f-41cd-bb34-28f926b2a6d5/local_831ce2b2-fb2f-4645-8476-5fd6f7359d9d/outputs/hubspot-crm-exports-all-deals-2026-05-06-cleaned.csv";

const ALREADY_MATCHED = new Set([
  "AI Solar Ltd", "Home Efficient Ltd", "JME Energy Ltd", "Optama", "SUNLIFE SOLAR UK LIMITED",
  "365 Energy Limited", "Synergy power Ltd", "Community Home Solutions", "Zoa Energy Solutions Ltd",
  "Resolve Home Energy Ltd", "The Energy Experts", "Grant Store Limited", "Thrift Energy",
  "Skilled Force", "Heat4Energy", "ARPG Eco Ltd", "Aran Insulation Ltd", "Apex Nationwide Ltd",
  "Advanced Eco Ltd", "ECO 247", "Eco Target", "ECO4 Pro", "Monza Installs", "WDS Green Energy",
  "A&D Carbon Solutions Ltd", "Emerald Green Energy", "Jones and Baker", "LMF Energy Services",
  "Zenith ECO Solutions", "All Seasons Energy", "Berks Insulation", "Zing Energy", "LD Eco",
  "Wizard Eco", "ECO Providers", "Outlook Energy Solutions", "South Rings Energy",
  "Clean Energy Nationwide", "Green Home Systems", "Eco Funding For Homes Ltd", "H&R Energy Solutions",
  "Stellar Energy", "Nano Pro Tech Ltd", "Unclouded solar", "Heatpac", "Golden Globe Ltd",
  "1st Call Gas", "SimplexEco", "Boiler Genie", "Arktek", "All Eco UK", "Eko Build",
  "Retro Renewables (Verde Power)", "JDS Energy", "Improveasy",
]);

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^\w\s&]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(ltd|limited|plc|llp|uk|t\/a)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPhone(p: string): string {
  return p.replace(/[\s\-\(\)\.+]/g, "").replace(/^44/, "0").replace(/^0+/, "");
}

function getDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

function extractFromNotes(notes: string): { websites: string[]; emails: string[]; phones: string[] } {
  const websites = [...new Set((notes.match(/https?:\/\/[^\s;,)"]+/g) || [])
    .filter(u => !u.includes("linkedin.com") && !u.includes("company-information.service.gov.uk") && !u.includes("facebook.com")))];
  const emails = [...new Set((notes.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || []))];
  const phones = [...new Set((notes.match(/(?:\+?44|0)\d[\d\s\-]{7,13}/g) || []).map(p => p.trim()))];
  return { websites, emails, phones };
}

// Levenshtein distance
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}

function wordOverlap(a: string, b: string): number {
  const aw = a.split(" ").filter(w => w.length > 2);
  const bw = b.split(" ").filter(w => w.length > 2);
  if (!aw.length || !bw.length) return 0;
  const overlap = aw.filter(w => bw.includes(w)).length;
  return overlap / Math.min(aw.length, bw.length);
}

async function main() {
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const { data: records } = Papa.parse(csvContent, { header: true, skipEmptyLines: true }) as { data: Record<string, string>[] };

  // Load all installers with all contact info
  const installers = await sql`
    SELECT id, company_name, website, telephone, email,
           website_sources, email_sources, telephone_sources, alternative_names
    FROM installers
  `;

  // Build indexes
  const dbByDomain = new Map<string, { id: number; name: string }[]>();
  const dbByPhone = new Map<string, { id: number; name: string }[]>();
  const dbByEmail = new Map<string, { id: number; name: string }[]>();
  const dbByNorm = new Map<string, { id: number; name: string }[]>();

  for (const i of installers) {
    const entry = { id: i.id, name: i.company_name };

    // Index by normalized name
    const n = normalize(i.company_name);
    if (!dbByNorm.has(n)) dbByNorm.set(n, []);
    dbByNorm.get(n)!.push(entry);

    // Also index alternative names
    if (i.alternative_names) {
      for (const alt of i.alternative_names.split(",").map((s: string) => s.trim())) {
        const altN = normalize(alt);
        if (altN && !dbByNorm.has(altN)) dbByNorm.set(altN, []);
        if (altN) dbByNorm.get(altN)!.push(entry);
      }
    }

    // Index by domain (primary + sources)
    const allWebsites: string[] = [];
    if (i.website) allWebsites.push(i.website);
    if (i.website_sources) {
      try {
        const sources = JSON.parse(i.website_sources);
        for (const s of sources) if (s.value) allWebsites.push(s.value);
      } catch {}
    }
    for (const w of allWebsites) {
      const d = getDomain(w);
      if (d && d !== "linkedin.com") {
        if (!dbByDomain.has(d)) dbByDomain.set(d, []);
        dbByDomain.get(d)!.push(entry);
      }
    }

    // Index by phone
    const allPhones: string[] = [];
    if (i.telephone) allPhones.push(i.telephone);
    if (i.telephone_sources) {
      try {
        const sources = JSON.parse(i.telephone_sources);
        for (const s of sources) if (s.value) allPhones.push(s.value);
      } catch {}
    }
    for (const p of allPhones) {
      const cleaned = cleanPhone(p);
      if (cleaned.length >= 6) {
        if (!dbByPhone.has(cleaned)) dbByPhone.set(cleaned, []);
        dbByPhone.get(cleaned)!.push(entry);
      }
    }

    // Index by email
    const allEmails: string[] = [];
    if (i.email) allEmails.push(i.email.toLowerCase());
    if (i.email_sources) {
      try {
        const sources = JSON.parse(i.email_sources);
        for (const s of sources) if (s.value) allEmails.push(s.value.toLowerCase());
      } catch {}
    }
    for (const e of allEmails) {
      if (!dbByEmail.has(e)) dbByEmail.set(e, []);
      dbByEmail.get(e)!.push(entry);
    }
  }

  const allNormNames = [...dbByNorm.entries()];

  let idx = 0;
  for (const row of records) {
    const dealName = (row["Deal Name"] || "").trim();
    if (!dealName || ALREADY_MATCHED.has(dealName)) continue;
    if (dealName === "Optama") continue;

    const stage = (row["Deal Stage"] || "").trim();
    const notes = (row["Associated Note"] || "").trim();
    const csvPhone = (row["deal contact number"] || "").trim();
    const { websites, emails, phones: notePhones } = extractFromNotes(notes);
    const allCsvPhones = [csvPhone, ...notePhones].filter(Boolean);
    const normalized = normalize(dealName);

    idx++;

    // 1. Domain match
    const domainMatches: { id: number; name: string; via: string }[] = [];
    for (const url of websites) {
      const d = getDomain(url);
      if (d) {
        const found = dbByDomain.get(d);
        if (found) {
          for (const f of found) domainMatches.push({ ...f, via: `domain:${d}` });
        }
      }
    }

    // 2. Phone match
    const phoneMatches: { id: number; name: string; via: string }[] = [];
    for (const p of allCsvPhones) {
      const cleaned = cleanPhone(p);
      if (cleaned.length >= 6) {
        const found = dbByPhone.get(cleaned);
        if (found) {
          for (const f of found) phoneMatches.push({ ...f, via: `phone:${p}` });
        }
        // Also try last 10 digits match
        const last10 = cleaned.slice(-10);
        if (last10.length >= 10) {
          for (const [dbP, entries] of dbByPhone) {
            if (dbP.slice(-10) === last10 && !found?.some(f => entries.some(e => e.id === f.id))) {
              for (const e of entries) phoneMatches.push({ ...e, via: `phone-partial:${p}` });
            }
          }
        }
      }
    }

    // 3. Email match
    const emailMatches: { id: number; name: string; via: string }[] = [];
    for (const e of emails) {
      const found = dbByEmail.get(e.toLowerCase());
      if (found) {
        for (const f of found) emailMatches.push({ ...f, via: `email:${e}` });
      }
      // Also try matching email domain to website domain
      const emailDomain = e.split("@")[1]?.toLowerCase();
      if (emailDomain && emailDomain !== "gmail.com" && emailDomain !== "hotmail.com" && emailDomain !== "yahoo.com" && emailDomain !== "outlook.com") {
        const found2 = dbByDomain.get(emailDomain);
        if (found2) {
          for (const f of found2) emailMatches.push({ ...f, via: `email-domain:${emailDomain}` });
        }
      }
    }

    // 4. Fuzzy name match (levenshtein + word overlap)
    const nameMatches: { id: number; name: string; via: string; score: number }[] = [];
    for (const [dbNorm, entries] of allNormNames) {
      // Exact substring (both ways, min 5 chars)
      if (normalized.length >= 5 && dbNorm.length >= 5) {
        if (dbNorm === normalized) {
          for (const e of entries) nameMatches.push({ ...e, via: "name-exact", score: 1.0 });
          continue;
        }
        // One contains the other
        if ((dbNorm.includes(normalized) || normalized.includes(dbNorm)) && Math.min(normalized.length, dbNorm.length) >= 5) {
          for (const e of entries) nameMatches.push({ ...e, via: "name-contains", score: 0.85 });
          continue;
        }
      }
      // Word overlap >= 60%
      const wo = wordOverlap(normalized, dbNorm);
      if (wo >= 0.6) {
        for (const e of entries) nameMatches.push({ ...e, via: `name-words(${Math.round(wo*100)}%)`, score: wo });
        continue;
      }
      // Levenshtein for short names (edit distance <= 2)
      if (normalized.length >= 4 && dbNorm.length >= 4 && Math.abs(normalized.length - dbNorm.length) <= 3) {
        const dist = levenshtein(normalized, dbNorm);
        if (dist <= 2) {
          for (const e of entries) nameMatches.push({ ...e, via: `name-lev(d=${dist})`, score: 1 - dist/Math.max(normalized.length, dbNorm.length) });
        }
      }
    }

    // Dedupe all matches
    const allMatches = new Map<number, { id: number; name: string; methods: string[] }>();
    for (const m of [...domainMatches, ...phoneMatches, ...emailMatches]) {
      if (!allMatches.has(m.id)) allMatches.set(m.id, { id: m.id, name: m.name, methods: [] });
      allMatches.get(m.id)!.methods.push(m.via);
    }
    // Add top name matches (sorted by score, limit 3)
    const topNames = nameMatches
      .sort((a, b) => b.score - a.score)
      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
      .slice(0, 5);
    for (const m of topNames) {
      if (!allMatches.has(m.id)) allMatches.set(m.id, { id: m.id, name: m.name, methods: [] });
      allMatches.get(m.id)!.methods.push(m.via);
    }

    // Sort by number of matching methods (more = more confident)
    const sorted = [...allMatches.values()].sort((a, b) => b.methods.length - a.methods.length);

    console.log(`${idx}. "${dealName}" | ${stage}`);
    if (sorted.length) {
      for (const m of sorted.slice(0, 5)) {
        const confidence = m.methods.some(m => m.startsWith("domain") || m.startsWith("phone") || m.startsWith("email"))
          ? "HIGH" : "low";
        console.log(`   ${confidence === "HIGH" ? ">>>" : "   "} [${m.id}] ${m.name} — matched by: ${m.methods.join(", ")}`);
      }
    } else {
      console.log(`   (no matches found)`);
    }
    console.log();
  }

  await sql.end();
}

main().catch(console.error);
