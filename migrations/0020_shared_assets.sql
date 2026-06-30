-- Shared asset library: an asset uploaded once by an admin and shown to many
-- studios. Visibility is controlled per asset via the junction table below —
-- an asset with NO visibility rows is visible to ALL studios.
CREATE TABLE IF NOT EXISTS shared_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_asset_visibility (
  asset_id TEXT NOT NULL REFERENCES shared_asset(id) ON DELETE CASCADE,
  studio_id TEXT NOT NULL REFERENCES studio(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, studio_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_asset_visibility_studio ON shared_asset_visibility(studio_id);
