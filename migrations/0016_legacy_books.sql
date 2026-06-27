-- Books that were already produced and integrated into the live audiobooks
-- system before this ops platform existed. Imported once for record-keeping;
-- never processed, never synced.
ALTER TABLE audiobook_record ADD COLUMN is_legacy INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_audiobook_record_is_legacy ON audiobook_record(is_legacy);
