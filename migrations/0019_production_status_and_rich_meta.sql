-- Per-book production status the studio drives: backlog → in_production → delivered.
ALTER TABLE studio_production_file ADD COLUMN production_status TEXT NOT NULL DEFAULT 'backlog';

-- Rich, delivery-style catalog metadata captured by the acquisition member at
-- assignment time (stored as a JSON blob so we don't need a column per field).
ALTER TABLE studio_production_file ADD COLUMN acq_metadata TEXT;

-- A delivery can be tied to the production-file (book) it fulfils, so uploading
-- a delivery from a book row marks that book "delivered".
ALTER TABLE studio_drive_upload ADD COLUMN production_file_id TEXT REFERENCES studio_production_file(id) ON DELETE SET NULL;
