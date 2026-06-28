-- Historical productions a studio completed before this system existed.
-- Imported once for billing/analytics history; no files, no processing.
CREATE TABLE IF NOT EXISTS studio_legacy_production (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studio(id) ON DELETE CASCADE,
  book_title TEXT NOT NULL,
  isbn TEXT,
  narrator TEXT,
  net_hours REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_studio_legacy_production_studio_id ON studio_legacy_production(studio_id);
