ALTER TABLE "linkedin_company_tracking" ADD COLUMN "last_scraped_employees_at" text;--> statement-breakpoint
-- Backfill: mark companies that already have contacts as scraped
UPDATE linkedin_company_tracking lct
SET last_scraped_employees_at = (
  SELECT MAX(lc.last_seen_at) FROM linkedin_contacts lc WHERE lc.installer_id = lct.installer_id
)
WHERE EXISTS (
  SELECT 1 FROM linkedin_contacts lc WHERE lc.installer_id = lct.installer_id
);