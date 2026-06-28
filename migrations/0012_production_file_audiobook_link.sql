-- Link a studio production file to a catalog audiobook record (the title the
-- studio is narrating). Nullable: production files may exist before assignment,
-- and studios are independent vendors (many-to-many with publishers via titles).
ALTER TABLE studio_production_file ADD COLUMN audiobook_id TEXT REFERENCES audiobook_record(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_studio_production_file_audiobook_id ON studio_production_file(audiobook_id);
