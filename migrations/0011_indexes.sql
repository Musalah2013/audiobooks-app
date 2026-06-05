-- Migration: Add indexes to studio tables and audit_event
-- Created: 2026-06-06

-- Studio-scoped indexes
CREATE INDEX IF NOT EXISTS idx_studio_asset_studio_id ON studio_asset(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_production_file_studio_id ON studio_production_file(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_sample_studio_id ON studio_sample(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_drive_upload_studio_id ON studio_drive_upload(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_magic_link_studio_id ON studio_magic_link(studio_id);

-- Acquisition magic link index
CREATE INDEX IF NOT EXISTS idx_acquisition_magic_link_user_id ON acquisition_magic_link(acquisition_user_id);

-- Audit event composite index for resource lookups
CREATE INDEX IF NOT EXISTS idx_audit_event_resource ON audit_event(resource_type, resource_id, created_at DESC);
