import { db } from "@/lib/db";
import {
  installers,
  googleReviews,
  googleBusinessInfo,
  enrichmentJobs,
  dataforseoTasks,
} from "@/lib/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

const BASE_URL = "https://api.dataforseo.com/v3";

function getAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DATAFORSEO credentials not set");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

// Single installer lookup using place_id
export async function fetchGoogleBusinessInfo(installerId: number): Promise<{ result?: Record<string, unknown>; error?: string }> {
  const auth = getAuth();

  // Get place_id from google_reviews
  const [review] = await db
    .select({ placeId: googleReviews.placeId })
    .from(googleReviews)
    .where(eq(googleReviews.installerId, installerId))
    .limit(1);

  if (!review?.placeId) {
    // Fall back to keyword search
    const [inst] = await db
      .select({ companyName: installers.companyName, postcode: installers.postcode })
      .from(installers)
      .where(eq(installers.id, installerId))
      .limit(1);

    if (!inst) return { error: "Installer not found" };

    const keyword = `${inst.companyName} ${inst.postcode || ""}`.trim();
    return await postAndPollBusinessInfo(auth, installerId, { keyword, location_name: "United Kingdom", language_name: "English" });
  }

  return await postAndPollBusinessInfo(auth, installerId, {
    keyword: `place_id:${review.placeId}`,
    location_name: "United Kingdom",
    language_name: "English",
  });
}

async function postAndPollBusinessInfo(
  auth: string,
  installerId: number,
  params: Record<string, string>
): Promise<{ result?: Record<string, unknown>; error?: string }> {
  // Post task
  const res = await fetch(`${BASE_URL}/business_data/google/my_business_info/task_post`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([{ ...params, priority: 1 }]),
  });

  const data = await res.json();
  if (data.status_code !== 20000) return { error: `API error ${data.status_code}: ${data.status_message}` };

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20100) return { error: `Task error: ${task?.status_message}` };

  // Save task
  await db.insert(dataforseoTasks).values({
    installerId,
    taskId: task.id,
    source: "google_business_info",
    endpoint: "business_data/google/my_business_info",
    status: "pending",
    searchTerm: params.keyword,
  });

  // Poll
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const getRes = await fetch(`${BASE_URL}/business_data/google/my_business_info/task_get/${task.id}`, {
      headers: { Authorization: auth },
    });
    const getData = await getRes.json();
    const t = getData?.tasks?.[0];

    if (t?.status_code === 20000 && t?.result?.[0]) {
      const result = t.result[0];

      // Upsert - update if exists, insert if not
      const newData = {
        placeId: result.place_id || null,
        title: result.title || null,
        phone: result.phone || null,
        website: result.domain || null,
        mainCategory: result.category || null,
        address: result.address || null,
        city: result.address_info?.city || null,
        postalCode: result.address_info?.zip || null,
        latitude: result.latitude || null,
        longitude: result.longitude || null,
        totalPhotos: result.total_photos || null,
        isClaimed: result.is_claimed ?? null,
        currentStatus: result.current_status || null,
        workHours: result.work_hours ? JSON.stringify(result.work_hours) : null,
        priceLevel: result.price_level || null,
        additionalCategories: result.additional_categories ? JSON.stringify(result.additional_categories) : null,
        fetchedAt: new Date().toISOString(),
      };
      const bizValues = { installerId, ...newData };
      await db.insert(googleBusinessInfo).values(bizValues)
        .onConflictDoUpdate({ target: googleBusinessInfo.installerId, set: newData });

      // Update task status
      await db.update(dataforseoTasks)
        .set({ status: "completed", resultSummary: `${result.title} | ${result.phone || "no phone"} | ${result.domain || "no website"}`, completedAt: new Date().toISOString() })
        .where(eq(dataforseoTasks.taskId, task.id));

      return { result };
    }

    if (t?.status_code === 40601 || t?.status_code === 40602) continue;
    if (t?.status_code === 40102) {
      await db.update(dataforseoTasks)
        .set({ status: "no_results", resultSummary: "No business found", completedAt: new Date().toISOString() })
        .where(eq(dataforseoTasks.taskId, task.id));
      return { error: "No business found" };
    }
    if (t?.status_code && t.status_code >= 40000) {
      await db.update(dataforseoTasks)
        .set({ status: "failed", resultSummary: `${t.status_code}: ${t.status_message}`, completedAt: new Date().toISOString() })
        .where(eq(dataforseoTasks.taskId, task.id));
      return { error: `Task failed: ${t.status_message}` };
    }
  }

  return { error: "Task timed out" };
}

// Batch submit for all installers with a place_id
export async function enrichGoogleBusinessBatch(jobId: number, priority: 1 | 2 = 1) {
  const auth = getAuth();

  // Find installers with a place_id but no business info
  const toEnrich = await db
    .select({
      installerId: googleReviews.installerId,
      placeId: googleReviews.placeId,
    })
    .from(googleReviews)
    .leftJoin(googleBusinessInfo, eq(googleReviews.installerId, googleBusinessInfo.installerId))
    .where(sql`${googleBusinessInfo.id} IS NULL AND ${googleReviews.placeId} IS NOT NULL`);

  await db.update(enrichmentJobs).set({
    totalItems: toEnrich.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let submitted = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Batch submit in groups of 100
  for (let i = 0; i < toEnrich.length; i += 100) {
    const [currentJob] = await db.select({ status: enrichmentJobs.status }).from(enrichmentJobs).where(eq(enrichmentJobs.id, jobId)).limit(1);
    if (currentJob?.status === "cancelled") break;

    const batch = toEnrich.slice(i, i + 100);

    const tasks = batch.map((inst) => ({
      keyword: `place_id:${inst.placeId}`,
      location_name: "United Kingdom",
      language_name: "English",
      priority,
      tag: String(inst.installerId),
    }));

    try {
      const result = await fetch(`${BASE_URL}/business_data/google/my_business_info/task_post`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(tasks),
      });
      const data = await result.json();
      if (data.status_code !== 20000) throw new Error(`API error ${data.status_code}`);

      for (const task of data.tasks || []) {
        if (task.status_code === 20100) {
          const instId = parseInt(task.data?.tag || "0", 10);
          await db.insert(dataforseoTasks).values({
            installerId: instId,
            taskId: task.id,
            source: "google_business_info",
            endpoint: "business_data/google/my_business_info",
            status: "pending",
            searchTerm: task.data?.keyword || null,
          });
          submitted++;
        } else {
          errors++;
        }
      }
    } catch (err) {
      errors += batch.length;
      errorLog.push(err instanceof Error ? err.message : String(err));
    }

    await db.update(enrichmentJobs).set({ processedItems: submitted, errorCount: errors }).where(eq(enrichmentJobs.id, jobId));
  }

  await db.update(enrichmentJobs).set({
    processedItems: submitted, errorCount: errors,
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog.slice(0, 50)) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(sql`${enrichmentJobs.id} = ${jobId} AND ${enrichmentJobs.status} != 'cancelled'`);
}
