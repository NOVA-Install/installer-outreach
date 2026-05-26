import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface TpItem {
  domain?: string;
  name?: string;
  display_name?: string;
  rating?: { value?: number };
  reviews_count?: number;
  trust_score?: number;
}

function findBestMatch(
  instName: string,
  instWebsite: string | null,
  filtered: TpItem[],
): { match: TpItem | null; reason: string } {
  // 1. Exact domain match
  if (instWebsite) {
    const instDomain = instWebsite
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
    const domainMatch = filtered.find((item) => {
      if (!item.domain) return false;
      return item.domain.replace(/^www\./, "").toLowerCase() === instDomain;
    });
    if (domainMatch) return { match: domainMatch, reason: "domain_exact" };
  }

  // 2. Strict name match
  for (const item of filtered) {
    const itemName = normalize(item.name || item.display_name || "");
    if (!itemName || itemName.length < 3) continue;

    if (instName === itemName) return { match: item, reason: "name_exact" };

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

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;

  // Get all completed trustpilot_search tasks (paginated)
  let allTasks: { id: number; installer_id: number; raw_result: string; result_summary: string }[] = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from("dataforseo_tasks")
      .select("id, installer_id, raw_result, result_summary")
      .eq("source", "trustpilot_search")
      .eq("status", "completed")
      .not("raw_result", "is", null)
      .range(page * 500, (page + 1) * 500 - 1);
    if (!data || data.length === 0) break;
    allTasks = allTasks.concat(data);
    if (data.length < 500) break;
    page++;
  }

  // Get installer details
  const installerIds = [...new Set(allTasks.map((t) => t.installer_id))];
  const installerMap = new Map<number, { company_name: string; website: string | null; postcode: string | null }>();
  for (let i = 0; i < installerIds.length; i += 500) {
    const batch = installerIds.slice(i, i + 500);
    const { data } = await supabase
      .from("installers")
      .select("id, company_name, website, postcode")
      .in("id", batch);
    if (data) {
      for (const row of data) {
        installerMap.set(row.id, { company_name: row.company_name, website: row.website, postcode: row.postcode });
      }
    }
  }

  let kept = 0;
  let rematched = 0;
  let rejected = 0;
  const rematchedList: { installerId: number; companyName: string; oldDomain: string; newDomain: string; newRating: number | null; matchReason: string }[] = [];
  const rejectedList: { installerId: number; companyName: string; oldDomain: string }[] = [];

  for (const task of allTasks) {
    const inst = installerMap.get(task.installer_id);
    if (!inst) continue;

    let result;
    try {
      result = JSON.parse(task.raw_result);
    } catch {
      continue;
    }

    const items: TpItem[] = result.items || [];
    const filtered = items.filter(
      (item) => item.domain && !NON_UK_TLDS.some((tld) => item.domain!.endsWith(tld))
    );

    const oldDomain = (task.result_summary || "").match(/(?:Matched|domain_exact|name_exact|name_substring|word_overlap).*?:\s*([^,]+)/)?.[1]?.trim() || "unknown";

    if (filtered.length === 0) {
      if (!dryRun) {
        await supabase.from("trustpilot_reviews").delete().eq("installer_id", task.installer_id);
        await supabase.from("dataforseo_tasks").update({
          status: "no_results",
          result_summary: "Revalidated: No UK results",
        }).eq("id", task.id);
      }
      rejected++;
      rejectedList.push({ installerId: task.installer_id, companyName: inst.company_name, oldDomain });
      continue;
    }

    const instName = normalize(inst.company_name);
    const { match: bestMatch, reason: matchReason } = findBestMatch(instName, inst.website, filtered);

    if (bestMatch) {
      const newDomain = bestMatch.domain || "unknown";
      const isSame = newDomain === oldDomain || `www.${oldDomain}` === newDomain || oldDomain === `www.${newDomain}`;

      if (isSame) {
        kept++;
      } else {
        rematched++;
        const newRating = bestMatch.rating?.value ?? null;
        rematchedList.push({ installerId: task.installer_id, companyName: inst.company_name, oldDomain, newDomain, newRating, matchReason });

        if (!dryRun) {
          await supabase.from("trustpilot_reviews").upsert({
            installer_id: task.installer_id,
            trustpilot_url: `https://www.trustpilot.com/review/${newDomain}`,
            rating: newRating,
            review_count: bestMatch.reviews_count ?? 0,
            trust_score: bestMatch.trust_score ?? null,
            fetched_at: new Date().toISOString(),
          }, { onConflict: "installer_id" });
          await supabase.from("dataforseo_tasks").update({
            result_summary: `Revalidated (${matchReason}): ${newDomain}, rating: ${newRating} (was: ${oldDomain})`,
          }).eq("id", task.id);
        }
      }
    } else {
      if (!dryRun) {
        await supabase.from("trustpilot_reviews").delete().eq("installer_id", task.installer_id);
        await supabase.from("dataforseo_tasks").update({
          status: "no_results",
          result_summary: `Revalidated: no valid match for "${inst.company_name}" (was: ${oldDomain})`,
        }).eq("id", task.id);
      }
      rejected++;
      rejectedList.push({ installerId: task.installer_id, companyName: inst.company_name, oldDomain });
    }
  }

  return new Response(JSON.stringify({
    dryRun,
    total: allTasks.length,
    kept,
    rematched,
    rejected,
    rematchedExamples: rematchedList.slice(0, 30),
    rejectedExamples: rejectedList.slice(0, 30),
    message: dryRun
      ? `DRY RUN: ${kept} kept, ${rematched} would be corrected to a better match, ${rejected} have no valid match. Set dryRun: false to apply.`
      : `Applied: ${kept} kept, ${rematched} corrected to right match, ${rejected} removed (no valid match).`,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
