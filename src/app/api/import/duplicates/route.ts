import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, installerSources } from "@/lib/db/schema";
import { sql, or, like, eq, and } from "drizzle-orm";
import { aiCheckDuplicate } from "@/lib/enrichment/ai-matcher";

interface IncomingRow {
  _rowIndex: number;
  companyName: string;
  postcode: string;
  installerId: string;
  // Source-specific identifiers
  trustmarkTmln?: string;
  novaEnfProfileUrl?: string;
  source?: "mcs" | "enf" | "trustmark";
}

// Step 2: Check for duplicates against existing database
export async function POST(request: NextRequest) {
  const { rows } = (await request.json()) as { rows: IncomingRow[] };

  const duplicates: {
    rowIndex: number;
    incomingName: string;
    incomingPostcode: string;
    existingId: number;
    existingName: string;
    existingPostcode: string | null;
    matchType: string;
  }[] = [];

  // Also check for duplicates within the CSV itself
  const csvDuplicates: {
    rowIndex: number;
    duplicateOfRowIndex: number;
    companyName: string;
    postcode: string;
    matchType: string;
  }[] = [];

  // Check within CSV
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.companyName.toLowerCase()}|${row.postcode.toLowerCase()}`;
    if (seen.has(key)) {
      csvDuplicates.push({
        rowIndex: row._rowIndex,
        duplicateOfRowIndex: seen.get(key)!,
        companyName: row.companyName,
        postcode: row.postcode,
        matchType: "exact_name_postcode",
      });
    } else {
      seen.set(key, row._rowIndex);
    }
  }

  // Check against database in batches
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);

    for (const row of batch) {
      if (!row.companyName) continue;

      // --- FIRST: Check installer_sources for an exact source_id match ---
      let sourceIdent: string | null = null;
      let sourceType: string | null = null;

      if (row.source === "mcs" && row.installerId) {
        sourceIdent = row.installerId;
        sourceType = "mcs";
      } else if (row.source === "trustmark" && row.trustmarkTmln) {
        sourceIdent = row.trustmarkTmln;
        sourceType = "trustmark";
      } else if (row.source === "enf" && row.novaEnfProfileUrl) {
        sourceIdent = row.novaEnfProfileUrl;
        sourceType = "enf";
      } else if (row.installerId) {
        // Fallback: if installerId looks like MCS format, treat as MCS
        sourceIdent = row.installerId;
        sourceType = "mcs";
      }

      if (sourceIdent && sourceType) {
        const sourceMatch = await db
          .select({
            installerId: installerSources.installerId,
          })
          .from(installerSources)
          .where(
            and(
              eq(installerSources.source, sourceType),
              eq(installerSources.sourceIdentifier, sourceIdent)
            )
          )
          .limit(1);

        if (sourceMatch.length > 0) {
          // Found via source tracking — strongest signal
          const [installer] = await db
            .select({
              id: installers.id,
              companyName: installers.companyName,
              postcode: installers.postcode,
            })
            .from(installers)
            .where(eq(installers.id, sourceMatch[0].installerId))
            .limit(1);

          if (installer) {
            duplicates.push({
              rowIndex: row._rowIndex,
              incomingName: row.companyName,
              incomingPostcode: row.postcode,
              existingId: installer.id,
              existingName: installer.companyName,
              existingPostcode: installer.postcode,
              matchType: "source_id",
            });
            continue; // Skip further matching for this row
          }
        }
      }

      // --- SECOND: Fall through to name/postcode matching and AI ---
      const conditions = [];

      // Match by installer ID (exact)
      if (row.installerId) {
        conditions.push(
          sql`${installers.installerId} = ${row.installerId}`
        );
      }

      // Match by name + postcode (exact)
      if (row.postcode) {
        conditions.push(
          sql`LOWER(${installers.companyName}) = LOWER(${row.companyName}) AND LOWER(${installers.postcode}) = LOWER(${row.postcode})`
        );
      }

      // Match by name only (fuzzy - starts with or contains)
      conditions.push(
        sql`LOWER(${installers.companyName}) = LOWER(${row.companyName})`
      );

      if (conditions.length === 0) continue;

      const matches = await db
        .select({
          id: installers.id,
          companyName: installers.companyName,
          postcode: installers.postcode,
          installerId: installers.installerId,
        })
        .from(installers)
        .where(or(...conditions))
        .limit(3);

      // Exact matches first
      for (const match of matches) {
        let matchType = "name_match";
        if (
          row.installerId &&
          match.installerId === row.installerId
        ) {
          matchType = "installer_id";
        } else if (
          match.companyName.toLowerCase() ===
            row.companyName.toLowerCase() &&
          match.postcode?.toLowerCase() === row.postcode.toLowerCase()
        ) {
          matchType = "exact_name_postcode";
        }

        duplicates.push({
          rowIndex: row._rowIndex,
          incomingName: row.companyName,
          incomingPostcode: row.postcode,
          existingId: match.id,
          existingName: match.companyName,
          existingPostcode: match.postcode,
          matchType,
        });
      }

      // If no exact match found, try AI fuzzy matching
      if (matches.length === 0 && process.env.GOOGLE_AI_API_KEY) {
        // Search for similar names (broader search)
        const fuzzyMatches = await db
          .select({
            id: installers.id,
            companyName: installers.companyName,
            postcode: installers.postcode,
            email: installers.email,
            website: installers.website,
          })
          .from(installers)
          .where(
            sql`LOWER(${installers.companyName}) LIKE LOWER(${`%${row.companyName.split(/\s+/)[0]}%`})`
          )
          .limit(5);

        if (fuzzyMatches.length > 0) {
          try {
            const aiResult = await aiCheckDuplicate(
              { companyName: row.companyName, postcode: row.postcode },
              fuzzyMatches.map((m, idx) => ({
                index: idx,
                companyName: m.companyName,
                postcode: m.postcode,
                email: m.email,
                website: m.website,
              }))
            );

            if (aiResult.isDuplicate && aiResult.matchIndex != null) {
              const match = fuzzyMatches[aiResult.matchIndex];
              duplicates.push({
                rowIndex: row._rowIndex,
                incomingName: row.companyName,
                incomingPostcode: row.postcode,
                existingId: match.id,
                existingName: match.companyName,
                existingPostcode: match.postcode,
                matchType: `ai_fuzzy (${aiResult.confidence}): ${aiResult.reasoning}`,
              });
            }
          } catch {
            // AI unavailable — skip fuzzy matching
          }
        }
      }
    }
  }

  return NextResponse.json({
    dbDuplicates: duplicates,
    csvDuplicates,
    stats: {
      dbDuplicateRows: new Set(duplicates.map((d) => d.rowIndex)).size,
      csvDuplicateRows: csvDuplicates.length,
    },
  });
}
