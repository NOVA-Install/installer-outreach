import { db } from "../src/lib/db";
import { dataforseoTasks } from "../src/lib/db/schema";
import { sql, eq } from "drizzle-orm";

async function check() {
  const stats = await db.select({
    source: dataforseoTasks.source,
    status: dataforseoTasks.status,
    count: sql<number>`count(*)`,
  }).from(dataforseoTasks)
    .groupBy(dataforseoTasks.source, dataforseoTasks.status);

  console.log("Task status breakdown:");
  console.log(JSON.stringify(stats, null, 2));

  const failed = await db.select({
    id: dataforseoTasks.id,
    source: dataforseoTasks.source,
    status: dataforseoTasks.status,
    resultSummary: dataforseoTasks.resultSummary,
    searchTerm: dataforseoTasks.searchTerm,
    createdAt: dataforseoTasks.createdAt,
  }).from(dataforseoTasks)
    .where(eq(dataforseoTasks.status, "failed"))
    .limit(5);

  console.log("\nFailed tasks sample:");
  console.log(JSON.stringify(failed, null, 2));

  process.exit(0);
}

check().catch((e) => { console.error(e); process.exit(1); });
