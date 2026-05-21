import { db } from "../src/lib/db";
import { dataforseoTasks } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";

async function reset() {
  // Reset failed trustpilot tasks back to pending so they can be re-collected with AI
  const result = await db
    .update(dataforseoTasks)
    .set({ status: "pending", resultSummary: null, completedAt: null })
    .where(
      sql`${dataforseoTasks.status} = 'failed' AND ${dataforseoTasks.resultSummary} LIKE '%GOOGLE_AI_API_KEY%'`
    );

  console.log("Reset failed tasks back to pending. Run 'Collect Results' on the enrichment page to re-process them with AI.");
  process.exit(0);
}

reset().catch((e) => { console.error(e); process.exit(1); });
