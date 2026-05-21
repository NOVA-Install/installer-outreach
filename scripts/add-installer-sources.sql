-- Create installer_sources junction table
-- Tracks which source spreadsheet rows map to which installer record

CREATE TABLE IF NOT EXISTS installer_sources (
  id SERIAL PRIMARY KEY,
  installer_id INTEGER NOT NULL REFERENCES installers(id),
  source TEXT NOT NULL,              -- 'mcs', 'enf', or 'trustmark'
  source_identifier TEXT NOT NULL,   -- unique ID from that source
  source_company_name TEXT,          -- original company name in that spreadsheet
  source_postcode TEXT,              -- original postcode in that spreadsheet
  imported_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- Same source+identifier can't appear twice
ALTER TABLE installer_sources
  ADD CONSTRAINT uq_source_identifier UNIQUE (source, source_identifier);

-- Fast lookups by installer
CREATE INDEX IF NOT EXISTS idx_installer_sources_installer_id
  ON installer_sources (installer_id);

-- Fast lookups by source + identifier (covers the unique constraint too, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_installer_sources_source_lookup
  ON installer_sources (source, source_identifier);
