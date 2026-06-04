CREATE TABLE IF NOT EXISTS ingestion_batch (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  drive_link TEXT,
  upload_object_key TEXT,
  metadata_sheet_object_key TEXT,
  seller_id INTEGER,
  seller_name TEXT,
  intake_mode TEXT,
  status TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL DEFAULT '[]',
  normalization_json TEXT NOT NULL DEFAULT '{}',
  report_object_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_candidate (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  metadata_row_index INTEGER,
  title TEXT NOT NULL,
  author TEXT,
  subtitle TEXT,
  isbn TEXT,
  narrator TEXT,
  source_group_key TEXT,
  source_group_json TEXT NOT NULL DEFAULT '{}',
  samawy_candidates_json TEXT NOT NULL DEFAULT '[]',
  classification_decision TEXT,
  decision_reason TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES ingestion_batch(id)
);

CREATE TABLE IF NOT EXISTS audiobook_record (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  publisher_id INTEGER NOT NULL,
  publisher_name TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  genre TEXT,
  blurb TEXT,
  author TEXT,
  narrator TEXT,
  isbn TEXT,
  pub_year TEXT,
  selling_type TEXT,
  price REAL,
  track_count INTEGER NOT NULL DEFAULT 0,
  total_length_seconds REAL NOT NULL DEFAULT 0,
  total_original_size_bytes INTEGER NOT NULL DEFAULT 0,
  total_final_size_bytes INTEGER NOT NULL DEFAULT 0,
  mp3_specs_summary TEXT NOT NULL DEFAULT '{}',
  source_drive_link TEXT,
  importance_points INTEGER NOT NULL DEFAULT 0,
  classification_decision TEXT NOT NULL,
  cover_status TEXT NOT NULL DEFAULT 'missing',
  cover_object_key TEXT,
  dossier_status TEXT NOT NULL DEFAULT 'pending',
  dossier_workbook_key TEXT,
  dossier_audio_zip_key TEXT,
  clickup_task_id TEXT,
  clickup_task_url TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES ingestion_batch(id),
  FOREIGN KEY (candidate_id) REFERENCES ingestion_candidate(id)
);

CREATE TABLE IF NOT EXISTS track_record (
  id TEXT PRIMARY KEY,
  audiobook_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  original_detected_title TEXT,
  original_order_index INTEGER NOT NULL,
  original_size_bytes INTEGER NOT NULL DEFAULT 0,
  original_duration_seconds REAL NOT NULL DEFAULT 0,
  original_bitrate_kbps INTEGER,
  original_sample_rate_hz INTEGER,
  original_channels INTEGER,
  final_filename TEXT,
  final_title TEXT,
  final_order_index INTEGER,
  final_size_bytes INTEGER,
  final_duration_seconds REAL,
  final_bitrate_kbps INTEGER,
  final_sample_rate_hz INTEGER,
  final_channels INTEGER,
  title_provenance TEXT NOT NULL,
  transformation_notes TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (audiobook_id) REFERENCES audiobook_record(id)
);

CREATE TABLE IF NOT EXISTS processing_run (
  id TEXT PRIMARY KEY,
  audiobook_id TEXT NOT NULL,
  container_instance TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (audiobook_id) REFERENCES audiobook_record(id)
);

CREATE TABLE IF NOT EXISTS artifact_record (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  audiobook_id TEXT,
  artifact_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES ingestion_batch(id),
  FOREIGN KEY (audiobook_id) REFERENCES audiobook_record(id)
);

CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_candidate_batch_id ON ingestion_candidate(batch_id);
CREATE INDEX IF NOT EXISTS idx_audiobook_record_batch_id ON audiobook_record(batch_id);
CREATE INDEX IF NOT EXISTS idx_track_record_audiobook_id ON track_record(audiobook_id);
CREATE INDEX IF NOT EXISTS idx_processing_run_audiobook_id ON processing_run(audiobook_id);
CREATE INDEX IF NOT EXISTS idx_artifact_record_batch_id ON artifact_record(batch_id);
