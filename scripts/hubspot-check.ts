import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });

async function main() {
  const acts = await sql`SELECT id, type, content, created_at FROM activities WHERE installer_id = 4100 ORDER BY created_at`;
  console.log(`=== MONZA INSTALLS ACTIVITIES (${acts.length}) ===`);
  for (const a of acts) {
    console.log(`[${a.id}] ${a.created_at} | ${a.type} | ${(a.content as string).slice(0, 80)}...`);
  }
  await sql.end();
}
main();
