-- Acquisition-supplied metadata on a production file (the book assignment).
-- The book title is the existing `name`; add author + free-text notes.
ALTER TABLE studio_production_file ADD COLUMN book_author TEXT;
ALTER TABLE studio_production_file ADD COLUMN acq_notes TEXT;
