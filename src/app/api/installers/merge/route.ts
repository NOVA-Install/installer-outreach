import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  trustpilotReviews,
  reviewItems,
  companiesHouseData,
  marketingSignals,
  seoData,
  trafficData,
  keywordData,
  activities,
  dataforseoTasks,
  installerTags,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

interface SourceValue {
  value: string;
  source: string;
}

function mergeSources(primaryJson: string | null, secondaryJson: string | null): string | null {
  const primary: SourceValue[] = primaryJson ? JSON.parse(primaryJson) : [];
  const secondary: SourceValue[] = secondaryJson ? JSON.parse(secondaryJson) : [];

  const merged = [...primary];
  for (const item of secondary) {
    const exists = merged.some(
      (m) => m.value.toLowerCase() === item.value.toLowerCase() && m.source === item.source
    );
    if (!exists) merged.push(item);
  }

  return merged.length > 0 ? JSON.stringify(merged) : null;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (v != null && v !== "") return v;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { primaryId, secondaryId } = body;

  if (!primaryId || !secondaryId || primaryId === secondaryId) {
    return NextResponse.json({ error: "Invalid merge: provide two different installer IDs" }, { status: 400 });
  }

  // Fetch both records
  const [primary] = await db.select().from(installers).where(eq(installers.id, primaryId)).limit(1);
  const [secondary] = await db.select().from(installers).where(eq(installers.id, secondaryId)).limit(1);

  if (!primary || !secondary) {
    return NextResponse.json({ error: "One or both installers not found" }, { status: 404 });
  }

  // --- 1. Merge installer fields: primary wins, fill gaps from secondary ---
  const mergedFields: Record<string, unknown> = {
    // Fill empty primary fields from secondary
    email: firstNonEmpty(primary.email, secondary.email),
    telephone: firstNonEmpty(primary.telephone, secondary.telephone),
    website: firstNonEmpty(primary.website, secondary.website),
    address: firstNonEmpty(primary.address, secondary.address),
    county: firstNonEmpty(primary.county, secondary.county),
    postcode: firstNonEmpty(primary.postcode, secondary.postcode),
    country: firstNonEmpty(primary.country, secondary.country),
    latitude: primary.latitude ?? secondary.latitude,
    longitude: primary.longitude ?? secondary.longitude,
    installerId: firstNonEmpty(primary.installerId, secondary.installerId),
    certificationNumber: firstNonEmpty(primary.certificationNumber, secondary.certificationNumber),
    certificationBody: firstNonEmpty(primary.certificationBody, secondary.certificationBody),
    legalEntityName: firstNonEmpty(primary.legalEntityName, secondary.legalEntityName),
    legalEntityNumber: firstNonEmpty(primary.legalEntityNumber, secondary.legalEntityNumber),
    websiteStatus: firstNonEmpty(primary.websiteStatus, secondary.websiteStatus),

    // Merge alternative names
    alternativeNames: [primary.alternativeNames, secondary.alternativeNames, secondary.companyName]
      .filter(Boolean)
      .join("; "),

    // Source flags: true if either is true
    inNova: primary.inNova || secondary.inNova,
    inMcs: primary.inMcs || secondary.inMcs,
    inTrustMark: primary.inTrustMark || secondary.inTrustMark,
    sourceCount: Math.max(primary.sourceCount ?? 0, secondary.sourceCount ?? 0),

    // Merge multi-source JSON fields
    websiteSources: mergeSources(primary.websiteSources, secondary.websiteSources),
    emailSources: mergeSources(primary.emailSources, secondary.emailSources),
    telephoneSources: mergeSources(primary.telephoneSources, secondary.telephoneSources),
    addressSources: mergeSources(primary.addressSources, secondary.addressSources),
    companyNameSources: mergeSources(primary.companyNameSources, secondary.companyNameSources),

    // MCS fields
    boilerUpgradeScheme: firstNonEmpty(primary.boilerUpgradeScheme, secondary.boilerUpgradeScheme),
    technologiesCertified: firstNonEmpty(primary.technologiesCertified, secondary.technologiesCertified),
    regionsCovered: firstNonEmpty(primary.regionsCovered, secondary.regionsCovered),

    // Nova fields
    novaYearStarted: firstNonEmpty(primary.novaYearStarted, secondary.novaYearStarted),
    novaBatteryStorage: firstNonEmpty(primary.novaBatteryStorage, secondary.novaBatteryStorage),
    novaLocationArea: firstNonEmpty(primary.novaLocationArea, secondary.novaLocationArea),
    novaIncorporatedName: firstNonEmpty(primary.novaIncorporatedName, secondary.novaIncorporatedName),
    novaEnfProfileUrl: firstNonEmpty(primary.novaEnfProfileUrl, secondary.novaEnfProfileUrl),

    // TrustMark fields
    trustmarkTmln: firstNonEmpty(primary.trustmarkTmln, secondary.trustmarkTmln),
    trustmarkDistrict: firstNonEmpty(primary.trustmarkDistrict, secondary.trustmarkDistrict),
    trustmarkRegion: firstNonEmpty(primary.trustmarkRegion, secondary.trustmarkRegion),
    trustmarkNationalCoverage: firstNonEmpty(primary.trustmarkNationalCoverage, secondary.trustmarkNationalCoverage),
    trustmarkSchemeProviders: firstNonEmpty(primary.trustmarkSchemeProviders, secondary.trustmarkSchemeProviders),
    trustmarkMemberSince: firstNonEmpty(primary.trustmarkMemberSince, secondary.trustmarkMemberSince),
    trustmarkDescription: firstNonEmpty(primary.trustmarkDescription, secondary.trustmarkDescription),
    trustmarkProfileUrl: firstNonEmpty(primary.trustmarkProfileUrl, secondary.trustmarkProfileUrl),
    trustmarkStatus: firstNonEmpty(primary.trustmarkStatus, secondary.trustmarkStatus),

    // Keep primary's pipeline stage (more likely to be current)
    pipelineStage: primary.pipelineStage !== "uncontacted" ? primary.pipelineStage : secondary.pipelineStage,

    updatedAt: new Date().toISOString(),
  };

  await db.update(installers).set(mergedFields).where(eq(installers.id, primaryId));

  // --- 2. Reassign related records from secondary to primary ---

  // For tables that should only have one row per installer, delete primary's if secondary has one
  // and we want to keep the richer data. Strategy: keep whichever exists on primary, only reassign
  // from secondary if primary doesn't have one.

  const reassignTables = [
    { table: reviewItems, fk: reviewItems.installerId },
    { table: activities, fk: activities.installerId },
    { table: dataforseoTasks, fk: dataforseoTasks.installerId },
    { table: keywordData, fk: keywordData.installerId },
  ];

  for (const { table, fk } of reassignTables) {
    await db.update(table).set({ installerId: primaryId }).where(eq(fk, secondaryId));
  }

  // For unique-per-installer tables: keep primary's if it exists, otherwise reassign secondary's
  const singletonTables = [
    { table: googleReviews, fk: googleReviews.installerId },
    { table: trustpilotReviews, fk: trustpilotReviews.installerId },
    { table: companiesHouseData, fk: companiesHouseData.installerId },
    { table: marketingSignals, fk: marketingSignals.installerId },
    { table: seoData, fk: seoData.installerId },
    { table: trafficData, fk: trafficData.installerId },
    { table: installerScores, fk: installerScores.installerId },
  ];

  for (const { table, fk } of singletonTables) {
    const [primaryRow] = await db.select({ id: table.id }).from(table).where(eq(fk, primaryId)).limit(1);
    if (primaryRow) {
      // Primary already has data — delete secondary's
      await db.delete(table).where(eq(fk, secondaryId));
    } else {
      // Primary has no data — reassign secondary's
      await db.update(table).set({ installerId: primaryId }).where(eq(fk, secondaryId));
    }
  }

  // Tags: reassign, skip duplicates
  const secondaryTags = await db.select().from(installerTags).where(eq(installerTags.installerId, secondaryId));
  const primaryTags = await db.select().from(installerTags).where(eq(installerTags.installerId, primaryId));
  const primaryTagIds = new Set(primaryTags.map((t) => t.tagId));

  for (const tag of secondaryTags) {
    if (primaryTagIds.has(tag.tagId)) {
      await db.delete(installerTags).where(eq(installerTags.id, tag.id));
    } else {
      await db.update(installerTags).set({ installerId: primaryId }).where(eq(installerTags.id, tag.id));
    }
  }

  // --- 3. Log the merge as an activity ---
  await db.insert(activities).values({
    installerId: primaryId,
    type: "note",
    content: `Merged with "${secondary.companyName}" (ID: ${secondaryId}). Secondary record deleted.`,
  });

  // --- 4. Delete the secondary installer ---
  await db.delete(installers).where(eq(installers.id, secondaryId));

  return NextResponse.json({
    ok: true,
    primaryId,
    secondaryId,
    message: `Merged "${secondary.companyName}" into "${primary.companyName}"`,
  });
}
