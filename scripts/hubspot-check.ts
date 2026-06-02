import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });

async function main() {
  // Check what last_scraped_posts_at values look like
  const recent = await sql`
    SELECT lct.installer_id, lct.company_slug, lct.last_scraped_posts_at,
           i.company_name, i.is_shortlisted
    FROM linkedin_company_tracking lct
    JOIN installers i ON i.id = lct.installer_id
    WHERE lct.last_scraped_posts_at IS NOT NULL
    ORDER BY lct.last_scraped_posts_at DESC
    LIMIT 10
  `;
  console.log("=== Most recent scrapes ===");
  for (const r of recent) {
    console.log(`  [${r.installer_id}] ${r.company_name} | shortlisted=${r.is_shortlisted} | last_scraped=${r.last_scraped_posts_at}`);
  }

  // Check what NOW() minus 7 days gives us
  const timeCheck = await sql`SELECT NOW() as now, NOW() - INTERVAL '7 days' as cutoff`;
  console.log(`\nNOW(): ${timeCheck[0].now}`);
  console.log(`Cutoff (7d ago): ${timeCheck[0].cutoff}`);

  // Count how many are eligible with the cast
  const counts = await sql`
    SELECT
      COUNT(*) FILTER (WHERE lct.last_scraped_posts_at IS NULL) as never_scraped,
      COUNT(*) FILTER (WHERE lct.last_scraped_posts_at IS NOT NULL AND lct.last_scraped_posts_at::timestamptz < NOW() - INTERVAL '7 days') as older_than_7d,
      COUNT(*) FILTER (WHERE lct.last_scraped_posts_at IS NOT NULL AND lct.last_scraped_posts_at::timestamptz >= NOW() - INTERVAL '7 days') as within_7d
    FROM linkedin_company_tracking lct
    JOIN installers i ON i.id = lct.installer_id
    WHERE i.is_shortlisted = true
      AND lct.company_slug != '__not_found__'
      AND EXISTS (SELECT 1 FROM linkedin_contacts lc WHERE lc.installer_id = i.id)
  `;
  console.log(`\n=== Shortlisted + contacts + valid slug ===`);
  console.log(`  Never scraped: ${counts[0].never_scraped}`);
  console.log(`  Older than 7 days: ${counts[0].older_than_7d}`);
  console.log(`  Within 7 days: ${counts[0].within_7d}`);

  await sql.end();
}
main();
