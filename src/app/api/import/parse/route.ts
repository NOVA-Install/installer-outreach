import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";

// Step 1: Parse CSV and return structured preview without importing
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const text = await file.text();

  const { data, errors: parseErrors } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (parseErrors.length > 0 && parseErrors[0].type === "Delimiter") {
    return NextResponse.json(
      { error: "CSV parse errors", details: parseErrors.slice(0, 10) },
      { status: 400 }
    );
  }

  const rows = data as Record<string, string>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const isMergedFormat = headers.some(
    (h) => h.startsWith("MCS_") || h.startsWith("Nova_") || h.startsWith("TM_")
  );

  // Build normalized preview rows
  const preview = rows.map((row, i) => {
    const companyName = isMergedFormat
      ? (row["Company Name (any source)"] || row["MCS_Company Name"] || row["Nova_Company Name"] || row["TM_Company Name"] || "").trim()
      : (row["Company Name"] || "").trim();

    const postcode = isMergedFormat
      ? (row["Postcode (any source)"] || row["MCS_Postcode"] || row["TM_Postcode"] || "").trim()
      : (row["Postcode"] || "").trim();

    const website = isMergedFormat
      ? (row["MCS_Website"] || row["Nova_Website"] || row["TM_Website"] || "").trim()
      : (row["Website"] || "").trim();

    const email = isMergedFormat
      ? (row["MCS_Email"] || row["Nova_Email"] || row["TM_Email (masked)"] || "").trim()
      : (row["Email"] || "").trim();

    const installerId = row["MCS_Installer ID"] || row["Installer ID"] || "";
    const alternativeNames = row["Alternative Names / Trading Names"] || "";

    const inMcs = isMergedFormat ? row["In_MCS"]?.toLowerCase() === "true" : true;
    const inNova = isMergedFormat ? row["In_Nova"]?.toLowerCase() === "true" : false;
    const inTrustMark = isMergedFormat ? row["In_TrustMark"]?.toLowerCase() === "true" : false;

    return {
      _rowIndex: i,
      companyName,
      alternativeNames,
      postcode,
      website,
      email,
      installerId,
      inMcs,
      inNova,
      inTrustMark,
      missingWebsite: !website,
      missingName: !companyName,
      _raw: row, // Keep raw data for import step
    };
  });

  const stats = {
    total: preview.length,
    missingWebsite: preview.filter((r) => r.missingWebsite).length,
    missingCompanyName: preview.filter((r) => r.missingName).length,
    withMcs: preview.filter((r) => r.inMcs).length,
    withNova: preview.filter((r) => r.inNova).length,
    withTrustMark: preview.filter((r) => r.inTrustMark).length,
  };

  return NextResponse.json({
    format: isMergedFormat ? "merged" : "simple",
    headers,
    stats,
    preview: preview.slice(0, 20), // First 20 for UI preview
    allRows: preview, // All rows for subsequent steps
  });
}
