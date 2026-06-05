-- Add book_id to studio_sample to link samples to production files (books)
ALTER TABLE studio_sample ADD COLUMN book_id TEXT REFERENCES studio_production_file(id) ON DELETE SET NULL;

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_studio_sample_book_id ON studio_sample(book_id);
