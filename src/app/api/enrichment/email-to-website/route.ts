import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, enrichmentJobs } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

// Free/generic email providers to ignore
const IGNORE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "live.com", "live.co.uk", "msn.com", "aol.com", "aol.co.uk",
  "icloud.com", "me.com", "mac.com", "mail.com",
  "btinternet.com", "btopenworld.com", "sky.com", "virginmedia.com",
  "talktalk.net", "ntlworld.com", "blueyonder.co.uk", "tiscali.co.uk",
  "plusnet.com", "zen.co.uk", "onetel.com",
  "protonmail.com", "proton.me", "tutanota.com", "zoho.com",
  "ymail.com", "rocketmail.com", "fastmail.com",
]);

export async function POST() {
  // Find installers with email but no website
  const missing = await db
    .select({
      id: installers.id,
      email: installers.email,
      companyName: installers.companyName,
    })
    .from(installers)
    .where(
      sql`${installers.email} IS NOT NULL AND ${installers.email} != '' AND (${installers.website} IS NULL OR ${installers.website} = '')`
    );

  if (missing.length === 0) {
    return NextResponse.json({ filled: 0, total: 0, message: "No installers with email but no website" });
  }

  const [job] = await db.insert(enrichmentJobs).values({
    type: "email_to_website",
    status: "running",
    totalItems: missing.length,
    processedItems: 0,
    errorCount: 0,
    startedAt: new Date().toISOString(),
  }).returning();

  let filled = 0;
  let skipped = 0;

  for (const inst of missing) {
    const email = inst.email!;
    const atIdx = email.indexOf("@");
    if (atIdx === -1) { skipped++; continue; }

    const domain = email.slice(atIdx + 1).toLowerCase().trim();

    if (IGNORE_DOMAINS.has(domain)) {
      skipped++;
      continue;
    }

    // Set the domain as the website
    await db
      .update(installers)
      .set({
        website: domain,
        websiteStatus: "from_email",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(installers.id, inst.id));
    filled++;
  }

  await db.update(enrichmentJobs).set({
    processedItems: filled,
    errorCount: skipped,
    status: "completed",
    completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, job.id));

  return NextResponse.json({
    filled,
    skipped,
    total: missing.length,
    message: `Found ${filled} websites from email domains. ${skipped} skipped (free email providers).`,
  });
}
