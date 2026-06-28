-- Multiple login contacts (users) per studio
CREATE TABLE IF NOT EXISTS studio_contact (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studio(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(studio_id, email)
);
CREATE INDEX IF NOT EXISTS idx_studio_contact_studio_id ON studio_contact(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_contact_email ON studio_contact(email);

-- Seed the existing primary contact email as the first contact of each studio
INSERT OR IGNORE INTO studio_contact (id, studio_id, email)
  SELECT lower(hex(randomblob(16))), id, contact_email
  FROM studio WHERE contact_email IS NOT NULL AND contact_email <> '';

-- Per-studio rate for final audio, in USD per net hour
ALTER TABLE studio ADD COLUMN hourly_rate_usd REAL;

-- Production plan the studio fills after a sample is approved (on the assigned file)
ALTER TABLE studio_production_file ADD COLUMN narrator TEXT;
ALTER TABLE studio_production_file ADD COLUMN expected_net_hours REAL;
ALTER TABLE studio_production_file ADD COLUMN estimated_finish_hours REAL;

-- Final delivery data the studio fills when uploading the finished book
ALTER TABLE studio_drive_upload ADD COLUMN net_final_hours REAL;
ALTER TABLE studio_drive_upload ADD COLUMN notes TEXT;
