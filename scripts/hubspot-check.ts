import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });

async function main() {
  const count = await sql`
    SELECT COUNT(*) as total
    FROM installers
    WHERE is_shortlisted = true AND website IS NOT NULL AND website != ''
  `;
  console.log(`Shortlisted installers with websites: ${count[0].total}`);
  await sql.end();
}
main();
