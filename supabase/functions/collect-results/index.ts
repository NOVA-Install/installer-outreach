import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const dfsLogin = Deno.env.get("DATAFORSEO_LOGIN")!;
  const dfsPassword = Deno.env.get("DATAFORSEO_PASSWORD")!;
  const googleAiKey = Deno.env.get("GOOGLE_AI_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey);
  const dfsAuth = "Basic " + btoa(`${dfsLogin}:${dfsPassword}`);

  // Get all pending tasks
  const { data: pendingTasks, error: fetchErr } = await supabase
    .from("dataforseo_tasks")
    .select("*")
    .eq("status", "pending")
    .limit(2000);

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const total = pendingTasks?.length || 0;
  let collected = 0;
  let stillPending = 0;
  let errored = 0;
  let autoMatched = 0;
  let aiCalled = 0;
  let noResults = 0;

  // Helper: normalize name for comparison
  function normalize(s: string): string {
    return s.toLowerCase()
      .replace(/\b(ltd|limited|llp|plc|inc|t\/a|trading as)\b/g, "")
      .replace(/&amp;/g, "&")
      .replace(/[^a-z0-9&\s]/g, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  // Batch-load all installer details upfront (avoids N+1 queries)
  const installerIds = [...new Set(pendingTasks!.map((t) => t.installer_id))];
  const installerMap = new Map<number, { company_name: string; website: string | null; postcode: string | null; county: string | null }>();
  for (let b = 0; b < installerIds.length; b += 500) {
    const batch = installerIds.slice(b, b + 500);
    const { data } = await supabase
      .from("installers")
      .select("id, company_name, website, postcode, county")
      .in("id", batch);
    if (data) {
      for (const row of data) {
        installerMap.set(row.id, { company_name: row.company_name, website: row.website, postcode: row.postcode, county: row.county });
      }
    }
  }

  // Process in batches of 50
  for (let i = 0; i < total; i += 50) {
    const batch = pendingTasks!.slice(i, i + 50);

    await Promise.allSettled(batch.map(async (task) => {
      try {
        const res = await fetch(`${DATAFORSEO_BASE}/${task.endpoint}/task_get/${task.task_id}`, {
          headers: { Authorization: dfsAuth },
        });
        const data = await res.json();
        const dfsTask = data?.tasks?.[0];
        const rawResult = dfsTask?.result?.[0] ? JSON.stringify(dfsTask.result[0]) : null;

        // Still in queue
        if (dfsTask?.status_code === 40601 || dfsTask?.status_code === 40602) {
          stillPending++;
          return;
        }

        // No results from API
        if (dfsTask?.status_code === 40102) {
          await supabase.from("dataforseo_tasks").update({
            status: "no_results",
            result_summary: "No results found",
            raw_result: rawResult,
            completed_at: new Date().toISOString(),
          }).eq("id", task.id);
          noResults++;
          return;
        }

        // Error
        if (dfsTask?.status_code && dfsTask.status_code >= 40000) {
          await supabase.from("dataforseo_tasks").update({
            status: "failed",
            result_summary: `${dfsTask.status_code}: ${dfsTask.status_message}`,
            raw_result: rawResult,
            completed_at: new Date().toISOString(),
          }).eq("id", task.id);
          errored++;
          return;
        }

        const result = dfsTask?.result?.[0];

        // ─── Google Reviews ───
        if (task.source === "google_reviews" && result) {
          const ratingObj = result.rating;
          const ratingVal = typeof ratingObj === "object" ? ratingObj?.value : ratingObj;
          const reviewsCount = result.reviews_count || 0;
          const businessTitle = result.title || result.name || "";

          if (!ratingVal) {
            await supabase.from("dataforseo_tasks").update({
              status: "completed",
              result_summary: "No rating found in result",
              raw_result: rawResult,
              completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            collected++;
            return;
          }

          // Get installer from pre-loaded map
          const inst = installerMap.get(task.installer_id);
          if (!inst) {
            await supabase.from("dataforseo_tasks").update({
              status: "failed", result_summary: "Installer not found",
              raw_result: rawResult, completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            errored++;
            return;
          }

          // Name similarity pre-check
          const instName = normalize(inst.company_name);
          const bizName = normalize(businessTitle);
          const isExact = instName === bizName;
          const isClose = instName.includes(bizName) || bizName.includes(instName);
          const wordsInst = instName.split(" ").filter((w: string) => w.length > 1);
          const wordsBiz = bizName.split(" ").filter((w: string) => w.length > 1);
          const overlap = wordsInst.length > 0
            ? wordsInst.filter((w: string) => wordsBiz.includes(w)).length / wordsInst.length
            : 0;
          const isHighOverlap = overlap >= 0.6;

          let accepted = isExact || isClose || isHighOverlap;
          let matchMethod = isExact ? "exact" : isClose ? "close" : isHighOverlap ? `overlap ${Math.round(overlap * 100)}%` : "";

          // If names don't match, try AI (if available)
          if (!accepted && googleAiKey) {
            try {
              aiCalled++;
              const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleAiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: `Is "${businessTitle}" the same business as "${inst.company_name}" (solar installer in ${inst.postcode || "UK"})? Reply only YES or NO.` }] }],
                }),
              });
              const aiData = await aiRes.json();
              const answer = aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || "";
              if (answer.startsWith("YES")) {
                accepted = true;
                matchMethod = "ai_verified";
              } else {
                matchMethod = "ai_rejected";
              }
            } catch (aiErr) {
              // AI failed - reject uncertain match to be safe (consistent with Trustpilot)
              console.error(`AI call failed for installer ${task.installer_id}:`, aiErr instanceof Error ? aiErr.message : aiErr);
              accepted = false;
              matchMethod = "ai_unavailable_rejected";
            }
          } else if (!accepted) {
            matchMethod = "name_mismatch";
          }

          if (accepted) {
            await supabase.from("google_reviews").upsert({
              installer_id: task.installer_id,
              place_id: result.place_id || null,
              rating: ratingVal,
              review_count: reviewsCount,
              reviews_per_month: reviewsCount > 0 ? reviewsCount / 36 : null,
              business_status: null,
              fetched_at: new Date().toISOString(),
            }, { onConflict: "installer_id" });

            await supabase.from("dataforseo_tasks").update({
              status: "completed",
              result_summary: `${matchMethod}: "${businessTitle}", rating: ${ratingVal}, ${reviewsCount} reviews`,
              raw_result: rawResult,
              completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            autoMatched++;
          } else {
            await supabase.from("dataforseo_tasks").update({
              status: "no_results",
              result_summary: `Rejected (${matchMethod}): "${businessTitle}" doesn't match "${inst.company_name}"`,
              raw_result: rawResult,
              completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            noResults++;
          }

          collected++;
          return;
        }

        // ─── Trustpilot Search ───
        if (task.source === "trustpilot_search" && result) {
          const items = result.items || [];
          // Filter non-UK
          const nonUkTlds = [".dk", ".de", ".fr", ".nl", ".se", ".no", ".fi", ".es", ".it", ".pl", ".pt", ".at", ".ch", ".be", ".au", ".nz", ".ca", ".us", ".in", ".za", ".br"];
          const filtered = items.filter((item: { domain?: string }) =>
            item.domain && !nonUkTlds.some((tld: string) => item.domain!.endsWith(tld))
          );

          const inst = installerMap.get(task.installer_id);

          if (!inst || filtered.length === 0) {
            await supabase.from("dataforseo_tasks").update({
              status: "no_results",
              result_summary: filtered.length === 0 ? "No UK results" : "Installer not found",
              raw_result: rawResult,
              completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            noResults++;
            return;
          }

          // Find best match by name or domain
          let bestMatch = null;
          let matchReason = "";
          const instName = normalize(inst.company_name);

          // Check domain match first (most reliable)
          if (inst.website) {
            const instDomain = inst.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
            bestMatch = filtered.find((item: { domain?: string }) => {
              if (!item.domain) return false;
              const tpDomain = item.domain.replace(/^www\./, "").toLowerCase();
              return tpDomain === instDomain || instDomain === tpDomain;
            }) || null;
            if (bestMatch) matchReason = "domain_exact";
          }

          // Then strict name match
          if (!bestMatch) {
            for (const item of filtered) {
              const itemName = normalize(item.name || item.display_name || "");
              if (!itemName || itemName.length < 3) continue;

              // Exact match after normalization
              if (instName === itemName) {
                bestMatch = item;
                matchReason = "name_exact";
                break;
              }

              // Substring match only if the shorter string is substantial
              // (at least 60% the length of the longer one - prevents "creation" matching "energy creation experts")
              const shorter = instName.length < itemName.length ? instName : itemName;
              const longer = instName.length < itemName.length ? itemName : instName;
              if (shorter.length >= longer.length * 0.6 && longer.includes(shorter)) {
                bestMatch = item;
                matchReason = "name_substring";
                break;
              }

              // Word overlap - require both high overlap AND at least 2 common meaningful words
              const words1 = instName.split(" ").filter((w: string) => w.length > 2);
              const words2 = itemName.split(" ").filter((w: string) => w.length > 2);
              // Exclude very common generic words from overlap calculation
              const genericWords = new Set(["energy", "solar", "green", "power", "home", "homes", "services", "solutions", "group", "uk", "heating", "electrical", "renewables", "renewable", "installation", "installations", "systems"]);
              const meaningfulCommon = words1.filter((w: string) => words2.includes(w) && !genericWords.has(w));
              const allCommon = words1.filter((w: string) => words2.includes(w));

              // Need at least 1 non-generic word in common, AND high overall overlap
              if (meaningfulCommon.length >= 1 && words1.length > 0 && allCommon.length / words1.length >= 0.7) {
                bestMatch = item;
                matchReason = `word_overlap_${Math.round(allCommon.length / words1.length * 100)}%`;
                break;
              }
            }
          }

          // For non-exact matches, use AI verification if available
          if (bestMatch && matchReason !== "domain_exact" && matchReason !== "name_exact" && googleAiKey) {
            try {
              aiCalled++;
              const tpName = bestMatch.name || bestMatch.display_name || bestMatch.domain || "";
              const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleAiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: `Is the Trustpilot profile "${tpName}" (domain: ${bestMatch.domain || "unknown"}) the same business as "${inst.company_name}" (a solar/energy installer in ${inst.postcode || "UK"})? Consider that many companies have similar names with words like "solar", "energy", "green" etc. Only say YES if you are confident they are the SAME company. Reply only YES or NO.` }] }],
                }),
              });
              const aiData = await aiRes.json();
              const answer = aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || "";
              if (!answer.startsWith("YES")) {
                // AI rejected - clear the match
                const rejectedName = tpName;
                bestMatch = null;
                matchReason = `ai_rejected: "${rejectedName}" != "${inst.company_name}"`;
              } else {
                matchReason = `ai_verified (${matchReason})`;
              }
            } catch {
              // AI unavailable - reject uncertain matches to be safe
              bestMatch = null;
              matchReason = "ai_unavailable_rejected";
            }
          }

          if (bestMatch) {
            await supabase.from("trustpilot_reviews").upsert({
              installer_id: task.installer_id,
              trustpilot_url: bestMatch.domain ? `https://www.trustpilot.com/review/${bestMatch.domain}` : null,
              rating: bestMatch.rating?.value || null,
              review_count: bestMatch.reviews_count || 0,
              trust_score: bestMatch.trust_score || null,
              fetched_at: new Date().toISOString(),
            }, { onConflict: "installer_id" });

            await supabase.from("dataforseo_tasks").update({
              status: "completed",
              result_summary: `${matchReason}: ${bestMatch.domain}, rating: ${bestMatch.rating?.value}`,
              raw_result: rawResult,
              completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            collected++;
          } else {
            const topName = filtered[0]?.name || filtered[0]?.domain || "none";
            const rejectReason = matchReason.startsWith("ai_rejected") ? matchReason : `No match. Top: "${topName}" doesn't match "${inst.company_name}"`;
            await supabase.from("dataforseo_tasks").update({
              status: "no_results",
              result_summary: rejectReason,
              raw_result: rawResult,
              completed_at: new Date().toISOString(),
            }).eq("id", task.id);
            noResults++;
          }
          return;
        }

        // ─── Google Business Info ───
        if (task.source === "google_business_info" && result) {
          await supabase.from("google_business_info").upsert({
            installer_id: task.installer_id,
            place_id: result.place_id || null,
            title: result.title || null,
            phone: result.phone || null,
            website_domain: result.domain || null,
            main_category: result.category || null,
            address: result.address || null,
            city: result.address_info?.city || null,
            postal_code: result.address_info?.zip || null,
            latitude: result.latitude || null,
            longitude: result.longitude || null,
            total_photos: result.total_photos || null,
            is_claimed: result.is_claimed ?? null,
            current_status: result.current_status || null,
            work_hours: result.work_hours ? JSON.stringify(result.work_hours) : null,
            price_level: result.price_level || null,
            additional_categories: result.additional_categories ? JSON.stringify(result.additional_categories) : null,
            fetched_at: new Date().toISOString(),
          }, { onConflict: "installer_id" });

          await supabase.from("dataforseo_tasks").update({
            status: "completed",
            result_summary: `${result.title} | ${result.phone || "no phone"} | ${result.domain || "no website"}`,
            raw_result: rawResult,
            completed_at: new Date().toISOString(),
          }).eq("id", task.id);
          collected++;
          return;
        }

        // ─── Job Postings ───
        if (task.source === "job_postings" && result) {
          const jobDomains = ["indeed.co.uk", "indeed.com", "linkedin.com", "reed.co.uk", "totaljobs.com", "glassdoor.co.uk", "glassdoor.com", "cv-library.co.uk", "adzuna.co.uk"];
          const postings = (result.items || [])
            .filter((item: { type?: string; domain?: string }) =>
              item.type === "organic" && item.domain && jobDomains.some((jd: string) => item.domain!.includes(jd))
            )
            .map((item: { title?: string; domain?: string; url?: string; description?: string }) => ({
              title: item.title || "", source: item.domain || "", url: item.url || "",
              snippet: item.description?.substring(0, 200) || "",
            }))
            .slice(0, 20);

          const jobData = {
            installer_id: task.installer_id,
            total_postings: postings.length,
            postings: postings.length > 0 ? JSON.stringify(postings) : null,
            is_hiring: postings.length > 0,
            fetched_at: new Date().toISOString(),
          };

          await supabase.from("job_postings").upsert(jobData, { onConflict: "installer_id" });

          await supabase.from("dataforseo_tasks").update({
            status: "completed",
            result_summary: postings.length > 0 ? `Hiring: ${postings.length} postings` : "Not hiring",
            raw_result: rawResult,
            completed_at: new Date().toISOString(),
          }).eq("id", task.id);
          collected++;
          return;
        }

        // Unknown source - mark complete
        collected++;
      } catch (err) {
        console.error(`Task ${task.id} (${task.source}, installer ${task.installer_id}) failed:`, err instanceof Error ? err.message : err);
        errored++;
      }
    }));
  }

  const response = {
    total,
    collected,
    stillPending,
    errored,
    autoMatched,
    aiCalled,
    noResults,
    message: `Processed ${collected + noResults + errored} of ${total} tasks`,
  };

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
