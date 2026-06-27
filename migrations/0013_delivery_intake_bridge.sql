-- Bridge studio deliveries into the core intake pipeline.
-- A studio drive upload can be linked to the ingestion batch that processes it,
-- and a batch can record the studio it originated from. Both nullable: the vast
-- majority of batches are operator-created and have no studio.
ALTER TABLE studio_drive_upload ADD COLUMN batch_id TEXT REFERENCES ingestion_batch(id) ON DELETE SET NULL;
ALTER TABLE ingestion_batch ADD COLUMN studio_id TEXT REFERENCES studio(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_studio_drive_upload_batch_id ON studio_drive_upload(batch_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_studio_id ON ingestion_batch(studio_id);
