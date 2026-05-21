import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dataforseoTasks, trustpilotReviews, installers } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|inc|t\/a|trading as)\b/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9&\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const GENERIC_WORDS = new Set([
  "energy", "solar", "green", "power", "home", "homes", "services",
  "solutions", "group", "uk", "heating", "electrical", "renewables",
  "renewable", "installation", "installations", "systems",
]);

const NON_UK_TLDS = [
  ".dk", ".de", ".fr", ".nl", ".se", ".no", ".fi", ".es", ".it",
  ".pl", ".pt", ".at", ".ch", ".be", ".au", ".nz", ".ca", ".us", ".in", ".za", ".br",
];

function findBestMatch(
  instName: string,
  instWebsite: string | null,
  filtered: Record<string, unknown>[],
): { match: Record<string, unknown> | null; reason: string } {
  // 1. Exact domain match
  if (instWebsite) {
    const instDomain = instWebsite
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
    const domainMatch = filtered.find((item) => {
      const d = item.domain as string | undefined;
      if (!d) return false;
      return d.replace(/^www\./, "").toLowerCase() === instDomain;
    });
    if (domainMatch) return { match: domainMatch, reason: "domain_exact" };
  }

  // 2. Strict name match
  for (const item of filtered) {
    const itemName = normalize(
      (item.name as string) || (item.display_name as string) || ""
    );
    if (!itemName || itemName.length < 3) continue;

    if (instName === itemName) {
      return { match: item, reason: "name_exact" };
    }

    const shorter = instName.length < itemName.length ? instName : itemName;
    const longer = instName.length < itemName.length ? itemName : instName;
    if (shorter.length >= longer.length * 0.6 && longer.includes(shorter)) {
      return { match: item, reason: "name_substring" };
    }

    const words1 = instName.split(" ").filter((w) => w.length > 2);
    const words2 = itemName.split(" ").filter((w) => w.length > 2);
    const meaningfulCommon = words1.filter((w) => words2.includes(w) && !GENERIC_WORDS.has(w));
    const allCommon = words1.filter((w) => words2.includes(w));
    if (meaningfulCommon.length >= 1 && words1.length > 0 && allCommon.length / words1.length >= 0.7) {
      return { match: item, reason: `word_overlap_${Math.round((allCommon.length / words1.length) * 100)}%` };
    }
  }

  return { match: null, reason: "" };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;

  // First get task IDs and installer IDs (lightweight query, no raw_result)
  const taskIndex = await db
    .select({
      id: dataforseoTasks.id,
      installerId: dataforseoTasks.installerId,
      resultSummary: dataforseoTasks.resultSummary,
    })
    .from(dataforseoTasks)
    .where(sql`${dataforseoTasks.source} = 'trustpilot_search' AND ${dataforseoTasks.status} = 'completed' AND ${dataforseoTasks.rawResult} IS NOT NULL`);

  // Load all installer details
  const installerIds = [...new Set(taskIndex.map((t) => t.installerId))];
  const installerMap = new Map<number, { companyName: string; website: string | null; postcode: string | null }>();
  for (let i = 0; i < installerIds.length; i += 500) {
    const batch = installerIds.slice(i, i + 500);
    const rows = await db
      .select({ id: installers.id, companyName: installers.companyName, website: installers.website, postcode: installers.postcode })
      .from(installers)
      .where(sql`${installers.id} IN (${sql.join(batch.map((id) => sql`${id}`), sql`,`)})`);
    for (const row of rows) {
      installerMap.set(row.id, { companyName: row.companyName, website: row.website, postcode: row.postcode });
    }
  }

  let kept = 0;
  let rematched = 0;
  let rejected = 0;
  const rematchedList: { installerId: number; companyName: string; oldDomain: string; newDomain: string; newRating: number | null; matchReason: string }[] = [];
  const rejectedList: { installerId: number; companyName: string; oldDomain: string; oldSummary: string }[] = [];

  // Process in batches of 100, loading raw_result per batch
  for (let b = 0; b < taskIndex.length; b += 100) {
    const batchIds = taskIndex.slice(b, b + 100).map((t) => t.id);
    const batchTasks = await db
      .select({
        id: dataforseoTasks.id,
        installerId: dataforseoTasks.installerId,
        rawResult: dataforseoTasks.rawResult,
        resultSummary: dataforseoTasks.resultSummary,
      })
      .from(dataforseoTasks)
      .where(sql`${dataforseoTasks.id} IN (${sql.join(batchIds.map((id) => sql`${id}`), sql`,`)})`);

    for (const task of batchTasks) {
      const inst = installerMap.get(task.installerId);
      if (!inst) continue;

      let result;
      try {
        result = JSON.parse(task.rawResult!);
      } catch {
        continue;
      }

      const items = result.items || [];
      const filtered = items.filter(
        (item: { domain?: string }) =>
          item.domain && !NON_UK_TLDS.some((tld) => item.domain!.endsWith(tld))
      );

      const oldDomain = (task.resultSummary || "").match(/(?:Matched|domain_exact|name_exact|name_substring|word_overlap).*?:\s*([^,]+)/)?.[1]?.trim() || "unknown";

      if (filtered.length === 0) {
        if (!dryRun) {
          await db.delete(trustpilotReviews).where(eq(trustpilotReviews.installerId, task.installerId));
          await db.update(dataforseoTasks).set({
            status: "no_results",
            resultSummary: "Revalidated: No UK results",
          }).where(eq(dataforseoTasks.id, task.id));
        }
        rejected++;
        rejectedList.push({ installerId: task.installerId, companyName: inst.companyName, oldDomain, oldSummary: task.resultSummary || "" });
        continue;
      }

      const instName = normalize(inst.companyName);
      const { match: bestMatch, reason: matchReason } = findBestMatch(instName, inst.website, filtered);

      if (bestMatch) {
        const newDomain = (bestMatch.domain as string) || "unknown";
        const isSame = newDomain === oldDomain || `www.${oldDomain}` === newDomain || oldDomain === `www.${newDomain}`;

        if (isSame) {
          kept++;
        } else {
          rematched++;
          const newRating = (bestMatch.rating as { value?: number })?.value ?? null;
          rematchedList.push({ installerId: task.installerId, companyName: inst.companyName, oldDomain, newDomain, newRating, matchReason });

          if (!dryRun) {
            const reviewCount = (bestMatch.reviews_count as number) ?? 0;
            const trustScore = (bestMatch.trust_score as number) ?? null;
            await db.delete(trustpilotReviews).where(eq(trustpilotReviews.installerId, task.installerId));
            await db.insert(trustpilotReviews).values({
              installerId: task.installerId,
              trustpilotUrl: newDomain ? `https://www.trustpilot.com/review/${newDomain}` : null,
              rating: newRating,
              reviewCount,
              trustScore,
              fetchedAt: new Date().toISOString(),
            });
            await db.update(dataforseoTasks).set({
              resultSummary: `Revalidated (${matchReason}): ${newDomain}, rating: ${newRating} (was: ${oldDomain})`,
            }).where(eq(dataforseoTasks.id, task.id));
          }
        }
      } else {
        if (!dryRun) {
          await db.delete(trustpilotReviews).where(eq(trustpilotReviews.installerId, task.installerId));
          await db.update(dataforseoTasks).set({
            status: "no_results",
            resultSummary: `Revalidated: no valid match for "${inst.companyName}" (was: ${oldDomain})`,
          }).where(eq(dataforseoTasks.id, task.id));
        }
        rejected++;
        rejectedList.push({ installerId: task.installerId, companyName: inst.companyName, oldDomain, oldSummary: task.resultSummary || "" });
      }
    }
  }

  return NextResponse.json({
    dryRun,
    total: taskIndex.length,
    kept,
    rematched,
    rejected,
    rematchedExamples: rematchedList.slice(0, 30),
    rejectedExamples: rejectedList.slice(0, 30),
    message: dryRun
      ? `DRY RUN: ${kept} kept, ${rematched} would be corrected to a better match, ${rejected} have no valid match. Set dryRun: false to apply.`
      : `Applied: ${kept} kept, ${rematched} corrected to right match, ${rejected} removed (no valid match).`,
  });
}
