import { db } from "@/lib/db";
import {
  installers,
  jobPostings,
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

const JOB_DOMAINS = ["indeed.co.uk", "indeed.com", "linkedin.com", "reed.co.uk", "totaljobs.com", "glassdoor.co.uk", "glassdoor.com", "cv-library.co.uk", "monster.co.uk", "adzuna.co.uk", "jora.com"];

// Single installer lookup (live - instant)
export async function fetchJobPostings(installerId: number): Promise<{ result?: Record<string, unknown>; error?: string }> {
  const auth = getAuth();

  const [inst] = await db
    .select({ companyName: installers.companyName })
    .from(installers)
    .where(eq(installers.id, installerId))
    .limit(1);

  if (!inst) return { error: "Installer not found" };

  const searchQuery = `"${inst.companyName}" jobs hiring`;

  const res = await fetch(`${BASE_URL}/serp/google/organic/live/regular`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([{
      keyword: searchQuery,
      location_name: "United Kingdom",
      language_name: "English",
      depth: 20,
    }]),
  });

  const data = await res.json();
  if (data.status_code !== 20000) return { error: `API error ${data.status_code}: ${data.status_message}` };

  const task = data.tasks?.[0];
  if (task?.status_code !== 20000) return { error: `Task error ${task?.status_code}: ${task?.status_message}` };

  const items = task?.result?.[0]?.items || [];

  const postingsFound = items
    .filter((item: { type?: string; domain?: string }) =>
      item.type === "organic" && item.domain && JOB_DOMAINS.some((jd) => item.domain!.includes(jd))
    )
    .map((item: { title?: string; domain?: string; url?: string; description?: string }) => ({
      title: item.title || "",
      source: item.domain || "",
      url: item.url || "",
      snippet: item.description?.substring(0, 200) || "",
    }))
    .slice(0, 20);

  const isHiring = postingsFound.length > 0;

  // Only update if we got valid data (don't overwrite with empty on failure)
  const existingJob = await db.select({ id: jobPostings.id }).from(jobPostings).where(eq(jobPostings.installerId, installerId)).limit(1);
  if (existingJob.length > 0) {
    await db.update(jobPostings).set({
      totalPostings: postingsFound.length,
      postings: postingsFound.length > 0 ? JSON.stringify(postingsFound) : null,
      isHiring,
      fetchedAt: new Date().toISOString(),
    }).where(eq(jobPostings.installerId, installerId));
  } else {
    await db.insert(jobPostings).values({
      installerId,
      totalPostings: postingsFound.length,
      postings: postingsFound.length > 0 ? JSON.stringify(postingsFound) : null,
      isHiring,
      fetchedAt: new Date().toISOString(),
    });
  }

  return { result: { isHiring, totalPostings: postingsFound.length, postings: postingsFound.slice(0, 5) } };
}

// Batch - submit tasks via SERP task_post (async, no browser needed)
export async function enrichJobPostingsBatch(jobId: number) {
  const auth = getAuth();

  const toEnrich = await db
    .select({ id: installers.id, companyName: installers.companyName })
    .from(installers)
    .leftJoin(jobPostings, eq(installers.id, jobPostings.installerId))
    .where(isNull(jobPostings.id));

  await db.update(enrichmentJobs).set({
    totalItems: toEnrich.length, processedItems: 0, status: "running", startedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));

  let submitted = 0;
  let errors = 0;
  const errorLog: string[] = [];

  // Batch submit in groups of 100
  for (let i = 0; i < toEnrich.length; i += 100) {
    const batch = toEnrich.slice(i, i + 100);

    const tasks = batch.map((inst) => ({
      keyword: `"${inst.companyName}" jobs hiring`,
      location_name: "United Kingdom",
      language_name: "English",
      depth: 20,
      priority: 1,
      tag: String(inst.id),
    }));

    try {
      const result = await fetch(`${BASE_URL}/serp/google/organic/task_post`, {
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
            source: "job_postings",
            endpoint: "serp/google/organic",
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
    errorLog: errorLog.length > 0 ? JSON.stringify(errorLog) : null,
    status: "completed", completedAt: new Date().toISOString(),
  }).where(eq(enrichmentJobs.id, jobId));
}
