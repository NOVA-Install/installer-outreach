import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { installers, installerSources } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

// Helper: pick first non-empty value from multiple fields
function firstOf(...values: (string | undefined | null)[]): string | null {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

// Helper: collect all non-empty values with their source
function collectSources(
  ...pairs: [string | undefined | null, string][]
): string | null {
  const sources = pairs
    .filter(([val]) => val && val.trim())
    .map(([val, source]) => ({ value: val!.trim(), source }));
  return sources.length > 0 ? JSON.stringify(sources) : null;
}

function toBool(val: string | undefined | null): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1" || v === "y";
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const text = await file.text();

  const { data, errors: parseErrors } = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header: string) => header.trim(),
    quoteChar: '"',
    escapeChar: '"',
  });

  if (parseErrors.length > 0 && parseErrors[0].type === "Delimiter") {
    return NextResponse.json(
      { error: "CSV parse errors", details: parseErrors.slice(0, 10) },
      { status: 400 }
    );
  }

  const rows = data as Record<string, string>[];
  let imported = 0;
  let updated = 0;
  const validationErrors: { row: number; issues: string[] }[] = [];

  // Detect format: merged CSV vs simple MCS CSV
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const isMergedFormat = headers.some((h) => h.startsWith("MCS_") || h.startsWith("Nova_") || h.startsWith("TM_"));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 1;

    try {
      let values;

      if (isMergedFormat) {
        // Merged CSV format
        const companyName =
          row["Company Name (any source)"] ||
          row["MCS_Company Name"] ||
          row["Nova_Company Name"] ||
          row["TM_Company Name"];

        if (!companyName?.trim()) {
          validationErrors.push({ row: rowIndex, issues: ["No company name found"] });
          continue;
        }

        // Skip rows that have no source flags - these are likely leaked multi-line text
        const hasAnySource =
          toBool(row["In_MCS"]) || toBool(row["In_Nova"]) || toBool(row["In_TrustMark"]);
        const hasSourceCount = parseInt(row["Source Count"] || "0") > 0;
        if (!hasAnySource && !hasSourceCount) {
          validationErrors.push({ row: rowIndex, issues: [`Skipped: "${companyName}" has no source flags (likely a multi-line field overflow)`] });
          continue;
        }

        // Collect multi-source fields
        const websiteSources = collectSources(
          [row["MCS_Website"], "MCS"],
          [row["Nova_Website"], "Nova"],
          [row["TM_Website"], "TrustMark"]
        );
        const emailSources = collectSources(
          [row["MCS_Email"], "MCS"],
          [row["Nova_Email"], "Nova"],
          [row["TM_Email (masked)"], "TrustMark"]
        );
        const telephoneSources = collectSources(
          [row["MCS_Telephone"], "MCS"],
          [row["Nova_Phone"], "Nova"],
          [row["TM_Phone"], "TrustMark"]
        );
        const addressSources = collectSources(
          [row["MCS_Address"], "MCS"],
          [row["Nova_Address"], "Nova"],
          [[row["TM_Address Line 1"], row["TM_Address Line 2"], row["TM_Town"]].filter(Boolean).join(", "), "TrustMark"]
        );
        const companyNameSources = collectSources(
          [row["MCS_Company Name"], "MCS"],
          [row["Nova_Company Name"], "Nova"],
          [row["TM_Company Name"], "TrustMark"]
        );

        // Pick primary values (first non-empty)
        const website = firstOf(row["MCS_Website"], row["Nova_Website"], row["TM_Website"]);
        const email = firstOf(row["MCS_Email"], row["Nova_Email"], row["TM_Email (masked)"]);
        const telephone = firstOf(row["MCS_Telephone"], row["Nova_Phone"], row["TM_Phone"]);
        const address = firstOf(
          row["MCS_Address"],
          row["Nova_Address"],
          [row["TM_Address Line 1"], row["TM_Address Line 2"], row["TM_Town"]].filter(Boolean).join(", ") || null
        );
        const postcode = firstOf(row["Postcode (any source)"], row["MCS_Postcode"], row["TM_Postcode"]);
        const county = firstOf(row["MCS_County"], row["TM_County"]);
        const country = firstOf(row["MCS_Country"], row["TM_Country"]);
        const lat = parseFloat(row["MCS_Latitude"] || row["TM_Latitude"] || "");
        const lng = parseFloat(row["MCS_Longitude"] || row["TM_Longitude"] || "");

        values = {
          installerId: row["MCS_Installer ID"] || null,
          companyName: companyName.trim(),
          alternativeNames: row["Alternative Names / Trading Names"]?.trim() || null,
          certificationNumber: row["MCS_Certification Number"] || null,
          certificationBody: row["MCS_Certification Body"] || null,
          email,
          telephone,
          website,
          address,
          county,
          postcode,
          country,
          latitude: isNaN(lat) ? null : lat,
          longitude: isNaN(lng) ? null : lng,
          // Multi-source JSON
          websiteSources,
          emailSources,
          telephoneSources,
          addressSources,
          companyNameSources,
          // Source flags
          inNova: toBool(row["In_Nova"]),
          inMcs: toBool(row["In_MCS"]),
          inTrustMark: toBool(row["In_TrustMark"]),
          sourceCount: parseInt(row["Source Count"] || "0") || null,
          // MCS specific
          boilerUpgradeScheme: row["MCS_Boiler Upgrade Scheme"] || null,
          technologiesCertified: row["MCS_Technologies Certified"] || null,
          regionsCovered: row["MCS_Regions Covered"] || null,
          // Nova specific
          novaYearStarted: row["Nova_Year Started"] || null,
          novaBatteryStorage: row["Nova_Battery Storage"] || null,
          novaLocationArea: row["Nova_Location/Area"] || null,
          novaIncorporatedName: row["Nova_Incorporated Company Name"] || null,
          novaEnfProfileUrl: row["Nova_ENF Profile URL"] || null,
          // TrustMark specific
          trustmarkTmln: row["TM_TMLN"] || null,
          trustmarkDistrict: row["TM_District"] || null,
          trustmarkRegion: row["TM_Region"] || null,
          trustmarkNationalCoverage: row["TM_National Coverage"] || null,
          trustmarkSchemeProviders: row["TM_Scheme Provider(s)"] || null,
          trustmarkMemberSince: row["TM_TrustMark Member Since"] || null,
          trustmarkDescription: row["TM_About / Description"] || null,
          trustmarkProfileUrl: row["TM_TrustMark Profile URL"] || null,
          trustmarkStatus: row["TM_Status"] || null,
        };
      } else {
        // Simple MCS-only CSV format (backwards compatible)
        const companyName = row["Company Name"];
        if (!companyName?.trim()) {
          validationErrors.push({ row: rowIndex, issues: ["No company name"] });
          continue;
        }

        const lat = parseFloat(row["Latitude"] || "");
        const lng = parseFloat(row["Longitude"] || "");

        values = {
          installerId: row["Installer ID"] || null,
          companyName: companyName.trim(),
          certificationNumber: row["Certification Number"] || null,
          certificationBody: row["Certification Body"] || null,
          email: row["Email"] || null,
          telephone: row["Telephone"] || null,
          website: row["Website"] || null,
          address: row["Address"] || null,
          county: row["County"] || null,
          postcode: row["Postcode"] || null,
          country: row["Country"] || null,
          latitude: isNaN(lat) ? null : lat,
          longitude: isNaN(lng) ? null : lng,
          boilerUpgradeScheme: row["Boiler Upgrade Scheme"] || null,
          technologiesCertified: row["Technologies Certified"] || null,
          regionsCovered: row["Regions Covered"] || null,
          inMcs: true,
          sourceCount: 1,
        };
      }

      // Upsert by installer ID or company name + postcode
      const matchField = values.installerId
        ? sql`${installers.installerId} = ${values.installerId}`
        : sql`${installers.companyName} = ${values.companyName} AND ${installers.postcode} = ${values.postcode}`;

      const existing = await db
        .select({ id: installers.id })
        .from(installers)
        .where(matchField)
        .limit(1);

      let installerId: number;

      if (existing.length > 0) {
        installerId = existing[0].id;
        await db
          .update(installers)
          .set({ ...values, updatedAt: new Date().toISOString() })
          .where(sql`${installers.id} = ${installerId}`);
        updated++;
      } else {
        const [inserted] = await db.insert(installers).values(values).returning({ id: installers.id });
        installerId = inserted.id;
        imported++;
      }

      // Track source identifiers in installer_sources
      const sourceEntries: {
        installerId: number;
        source: string;
        sourceIdentifier: string;
        sourceCompanyName: string | null;
        sourcePostcode: string | null;
      }[] = [];

      if (isMergedFormat) {
        // MCS source
        if (values.installerId || values.inMcs) {
          const ident = values.installerId || `${values.companyName}|${values.postcode || ""}`;
          sourceEntries.push({
            installerId,
            source: "mcs",
            sourceIdentifier: ident,
            sourceCompanyName: values.companyName,
            sourcePostcode: values.postcode ?? null,
          });
        }
        // ENF/Nova source
        if (values.novaEnfProfileUrl || values.inNova) {
          const ident = values.novaEnfProfileUrl || `${values.companyName}|${values.postcode || ""}`;
          sourceEntries.push({
            installerId,
            source: "enf",
            sourceIdentifier: ident,
            sourceCompanyName: values.companyName,
            sourcePostcode: values.postcode ?? null,
          });
        }
        // TrustMark source
        if (values.trustmarkTmln || values.inTrustMark) {
          const ident = values.trustmarkTmln || `${values.companyName}|${values.postcode || ""}`;
          sourceEntries.push({
            installerId,
            source: "trustmark",
            sourceIdentifier: ident,
            sourceCompanyName: values.companyName,
            sourcePostcode: values.postcode ?? null,
          });
        }
      } else {
        // Simple MCS-only format
        if (values.installerId) {
          sourceEntries.push({
            installerId,
            source: "mcs",
            sourceIdentifier: values.installerId,
            sourceCompanyName: values.companyName,
            sourcePostcode: values.postcode ?? null,
          });
        }
      }

      for (const entry of sourceEntries) {
        await db
          .insert(installerSources)
          .values(entry)
          .onConflictDoNothing({ target: [installerSources.source, installerSources.sourceIdentifier] });
      }
    } catch (err) {
      validationErrors.push({
        row: rowIndex,
        issues: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  return NextResponse.json({
    imported,
    updated,
    total: rows.length,
    format: isMergedFormat ? "merged" : "simple",
    errors: validationErrors.slice(0, 50),
    errorCount: validationErrors.length,
  });
}
