/**
 * Full details on the 16 solar-related unmatched HubSpot companies
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import Papa from "papaparse";

config({ path: ".env.local" });

const CSV_PATH = "/Users/chris/Library/Application Support/Claude/local-agent-mode-sessions/afafca88-b212-4095-870c-95d4b6b6ec0d/ee1d94fa-1c0f-41cd-bb34-28f926b2a6d5/local_831ce2b2-fb2f-4645-8476-5fd6f7359d9d/outputs/hubspot-crm-exports-all-deals-2026-05-06-cleaned.csv";

const ALL_MATCHED = new Set([
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
  "Easy Build Solutions", "Bluebuild Insulation Ltd", "Macbrook Gas", "0800",
  "Legacy Eco Ltd", "Eco Giants", "DVC",
]);

// The 16 solar-related deal names from previous categorization
const SOLAR_DEALS = new Set([
  "Abu Bakr Usman Ali", "Heat Connect", "J & F Wilson - Plumbing & Heating Ltd",
  "Real Heating Solutions Ltd", "Ecoflex Solutions", "Atlas Insulation Ltd",
  "Shropshire Eco", "Swift Energy Solutions", "Energy Saving Group",
  "Boiler Hut", "Real Energy Limited", "SEWM", "C&T ECO Consultants",
  "Green Grants UK", "Next Energy UK", "Green Planet Solutions",
]);

function extractEmails(text: string): string[] {
  return [...new Set((text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || []))];
}

function extractWebsites(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s;,)"]+/g) || [])
    .filter(u => !u.includes("company-information.service.gov.uk")))];
}

async function main() {
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const { data: records } = Papa.parse(csvContent, { header: true, skipEmptyLines: true }) as { data: Record<string, string>[] };

  let idx = 0;
  for (const row of records) {
    const dealName = (row["Deal Name"] || "").trim();
    if (!dealName || ALL_MATCHED.has(dealName) || !SOLAR_DEALS.has(dealName)) continue;
    if (dealName === "Optama") continue;

    idx++;
    const stage = (row["Deal Stage"] || "").trim();
    const notes = (row["Associated Note"] || "").trim();
    const phone = (row["deal contact number"] || "").trim();
    const closedReason = (row["Closed Lost Reason"] || "").trim();
    const createDate = (row["Create Date"] || "").trim().split(" ")[0];
    const closeDate = (row["Close Date"] || "").trim().split(" ")[0];
    const contactFirst = (row["Applicant First Name"] || "").trim();
    const contactLast = (row["Applicant Last Name"] || "").trim();
    const contactName = [contactFirst, contactLast].filter(Boolean).join(" ");
    const priority = (row["Priority"] || "").trim();
    const activities = (row["Number of Sales Activities"] || "").trim();

    const websites = extractWebsites(notes);
    const emails = extractEmails(notes);
    const notesList = notes.split(";").map(n => n.trim()).filter(n => n.length > 2 && !/^\d+$/.test(n));

    console.log(`═══════════════════════════════════════════`);
    console.log(`${idx}. ${dealName}`);
    console.log(`   Stage: ${stage}${closedReason ? ` | Lost reason: ${closedReason}` : ""}`);
    console.log(`   Priority: ${priority} | Created: ${createDate} | Close: ${closeDate} | Activities: ${activities}`);
    if (contactName) console.log(`   Contact: ${contactName}`);
    if (phone) console.log(`   Phone: ${phone}`);
    if (websites.length) console.log(`   Website: ${websites.join(", ")}`);
    if (emails.length) console.log(`   Email: ${emails.join(", ")}`);
    if (notesList.length) {
      console.log(`   ── Notes (${notesList.length}) ──`);
      for (const note of notesList) {
        console.log(`   ${note}`);
        console.log();
      }
    }
    console.log();
  }
}

main().catch(console.error);
