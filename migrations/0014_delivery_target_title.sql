-- A studio delivery (finished audio) can target a pre-assigned catalog title.
-- When set, the delivery is attached directly to that audiobook and skips intake;
-- when null, the delivery creates an upload-type intake batch for operator review.
-- Drive is no longer used as a transport hop — studios upload straight to R2.
ALTER TABLE studio_drive_upload ADD COLUMN audiobook_id TEXT REFERENCES audiobook_record(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_studio_drive_upload_audiobook_id ON studio_drive_upload(audiobook_id);
