import type {
  ArtifactDescriptor,
  BatchStatus,
  CandidateDecision,
  CandidateStatus,
  ClickUpSyncStatus,
  DossierStatus,
  MetadataRow,
  NormalizedGroup,
  ProcessingJobResult,
  ProcessingStatus,
  SamawyBookCandidate,
  SampleSelection,
  SourceManifestItem,
  StorageCleanupStatus,
  SourceType,
  TrackApprovalStatus,
} from "./types";
import { jsonParse, nowIso } from "./utils";

type Row = Record<string, unknown>;

// ─── Studio row types ────────────────────────────────────────────────────────
type StudioRow = { id: string; name: string; slug: string; contact_email: string; drive_folder_id: string | null; logo_object_key: string | null; is_active: number; created_at: string; created_by: string; hourly_rate_usd: number | null };
type StudioContactRow = { id: string; studio_id: string; email: string; name: string | null; created_at: string };
type StudioLegacyProductionRow = { id: string; studio_id: string; book_title: string; isbn: string | null; narrator: string | null; net_hours: number | null; notes: string | null; created_at: string };
type StudioAggregate = {
  contacts: number; productionFiles: number; assignedFiles: number;
  samplesTotal: number; samplesPending: number; samplesApproved: number; samplesRefused: number;
  deliveries: number; deliveriesCompleted: number; netFinalHours: number;
  legacyProductions: number; legacyNetHours: number;
};
type StudioAssetRow = { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string };
type StudioProductionFileRow = { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string; audiobook_id: string | null; narrator: string | null; expected_net_hours: number | null; estimated_finish_hours: number | null };
type StudioSampleRow = { id: string; studio_id: string; book_id: string | null; name: string; object_key: string; content_type: string; size_bytes: number; status: string; reviewed_by: string | null; review_note: string | null; reviewed_at: string | null; created_at: string };
type StudioDriveUploadRow = { id: string; studio_id: string; name: string; object_key: string; drive_file_id: string | null; status: string; error: string | null; created_at: string; batch_id: string | null; audiobook_id: string | null; net_final_hours: number | null; notes: string | null };
type AcquisitionUserRow = { id: string; email: string; name: string; is_active: number; created_at: string; created_by: string };

function bindObject(stmt: D1PreparedStatement, values: unknown[]) {
  return stmt.bind(...values);
}

export interface IngestionBatchRecord {
  id: string;
  sourceType: SourceType;
  driveLink: string | null;
  uploadObjectKey: string | null;
  metadataSheetObjectKey: string | null;
  sellerId: number | null;
  sellerName: string | null;
  intakeMode: string | null;
  status: BatchStatus;
  sourceManifest: SourceManifestItem[];
  normalization: { groups?: NormalizedGroup[]; metadataRows?: MetadataRow[]; [key: string]: unknown };
  reportObjectKey: string | null;
  studioId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateRecord {
  id: string;
  batchId: string;
  metadataRowIndex: number | null;
  title: string;
  author: string | null;
  subtitle: string | null;
  isbn: string | null;
  narrator: string | null;
  sourceGroupKey: string | null;
  sourceGroup: NormalizedGroup | null;
  samawyCandidates: SamawyBookCandidate[];
  classificationDecision: CandidateDecision | null;
  decisionReason: string | null;
  status: CandidateStatus;
  metadataOverride: Partial<MetadataRow> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudiobookRecord {
  id: string;
  batchId: string;
  candidateId: string;
  publisherId: number;
  publisherName: string;
  title: string;
  subtitle: string | null;
  genre: string | null;
  blurb: string | null;
  author: string | null;
  narrator: string | null;
  isbn: string | null;
  pubYear: string | null;
  sellingType: string | null;
  price: number | null;
  trackCount: number;
  totalLengthSeconds: number;
  totalOriginalSizeBytes: number;
  totalFinalSizeBytes: number;
  mp3SpecsSummary: Record<string, unknown>;
  sourceDriveLink: string | null;
  importancePoints: number;
  classificationDecision: string;
  metadataSnapshot: Record<string, unknown>;
  storageBasePath: string | null;
  coverStatus: string;
  coverObjectKey: string | null;
  dossierStatus: DossierStatus;
  dossierWorkbookKey: string | null;
  dossierAudioZipKey: string | null;
  clickupTaskId: string | null;
  clickupTaskUrl: string | null;
  clickupSyncStatus: ClickUpSyncStatus;
  clickupSyncError: string | null;
  clickupSyncedAt: string | null;
  sampleTrackId: string | null;
  sampleStartSeconds: number | null;
  sampleEndSeconds: number | null;
  sampleObjectKey: string | null;
  sampleGeneratedAt: string | null;
  storageCleanupStatus: StorageCleanupStatus;
  storageCleanupError: string | null;
  processingStatus: ProcessingStatus;
  /** True for books imported from the pre-existing live system (no processing/sync). */
  isLegacy: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrackRecord {
  id: string;
  audiobookId: string;
  originalObjectKey: string | null;
  originalFilename: string;
  originalDetectedTitle: string | null;
  originalOrderIndex: number;
  originalSizeBytes: number;
  originalDurationSeconds: number;
  originalBitrateKbps: number | null;
  originalSampleRateHz: number | null;
  originalChannels: number | null;
  finalObjectKey: string | null;
  finalFilename: string | null;
  finalTitle: string | null;
  finalOrderIndex: number | null;
  finalSizeBytes: number | null;
  finalDurationSeconds: number | null;
  finalBitrateKbps: number | null;
  finalSampleRateHz: number | null;
  finalChannels: number | null;
  titleProvenance: string;
  transformationNotes: string | null;
  approvalStatus: TrackApprovalStatus;
  createdAt: string;
  updatedAt: string;
}

function mapBatch(row: Row): IngestionBatchRecord {
  return {
    id: String(row.id),
    sourceType: row.source_type as SourceType,
    driveLink: row.drive_link ? String(row.drive_link) : null,
    uploadObjectKey: row.upload_object_key ? String(row.upload_object_key) : null,
    metadataSheetObjectKey: row.metadata_sheet_object_key ? String(row.metadata_sheet_object_key) : null,
    sellerId: row.seller_id == null ? null : Number(row.seller_id),
    sellerName: row.seller_name ? String(row.seller_name) : null,
    intakeMode: row.intake_mode ? String(row.intake_mode) : null,
    status: row.status as BatchStatus,
    sourceManifest: jsonParse(row.source_manifest_json as string, []),
    normalization: jsonParse(row.normalization_json as string, {}),
    reportObjectKey: row.report_object_key ? String(row.report_object_key) : null,
    studioId: row.studio_id ? String(row.studio_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCandidate(row: Row): CandidateRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    metadataRowIndex: row.metadata_row_index == null ? null : Number(row.metadata_row_index),
    title: String(row.title),
    author: row.author ? String(row.author) : null,
    subtitle: row.subtitle ? String(row.subtitle) : null,
    isbn: row.isbn ? String(row.isbn) : null,
    narrator: row.narrator ? String(row.narrator) : null,
    sourceGroupKey: row.source_group_key ? String(row.source_group_key) : null,
    sourceGroup: jsonParse(row.source_group_json as string, null),
    samawyCandidates: jsonParse(row.samawy_candidates_json as string, []),
    classificationDecision: (row.classification_decision as CandidateDecision | null) ?? null,
    decisionReason: row.decision_reason ? String(row.decision_reason) : null,
    status: row.status as CandidateStatus,
    metadataOverride: jsonParse(row.metadata_override_json as string, null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAudiobook(row: Row): AudiobookRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    candidateId: String(row.candidate_id),
    publisherId: Number(row.publisher_id),
    publisherName: String(row.publisher_name),
    title: String(row.title),
    subtitle: row.subtitle ? String(row.subtitle) : null,
    genre: row.genre ? String(row.genre) : null,
    blurb: row.blurb ? String(row.blurb) : null,
    author: row.author ? String(row.author) : null,
    narrator: row.narrator ? String(row.narrator) : null,
    isbn: row.isbn ? String(row.isbn) : null,
    pubYear: row.pub_year ? String(row.pub_year) : null,
    sellingType: row.selling_type ? String(row.selling_type) : null,
    price: row.price == null ? null : Number(row.price),
    trackCount: Number(row.track_count ?? 0),
    totalLengthSeconds: Number(row.total_length_seconds ?? 0),
    totalOriginalSizeBytes: Number(row.total_original_size_bytes ?? 0),
    totalFinalSizeBytes: Number(row.total_final_size_bytes ?? 0),
    mp3SpecsSummary: jsonParse(row.mp3_specs_summary as string, {}),
    sourceDriveLink: row.source_drive_link ? String(row.source_drive_link) : null,
    importancePoints: Number(row.importance_points ?? 0),
    classificationDecision: String(row.classification_decision),
    metadataSnapshot: jsonParse(row.metadata_snapshot_json as string, {}),
    storageBasePath: row.storage_base_path ? String(row.storage_base_path) : null,
    coverStatus: String(row.cover_status),
    coverObjectKey: row.cover_object_key ? String(row.cover_object_key) : null,
    dossierStatus: row.dossier_status as DossierStatus,
    dossierWorkbookKey: row.dossier_workbook_key ? String(row.dossier_workbook_key) : null,
    dossierAudioZipKey: row.dossier_audio_zip_key ? String(row.dossier_audio_zip_key) : null,
    clickupTaskId: row.clickup_task_id ? String(row.clickup_task_id) : null,
    clickupTaskUrl: row.clickup_task_url ? String(row.clickup_task_url) : null,
    clickupSyncStatus: (row.clickup_sync_status as ClickUpSyncStatus | null) ?? "never_synced",
    clickupSyncError: row.clickup_sync_error ? String(row.clickup_sync_error) : null,
    clickupSyncedAt: row.clickup_synced_at ? String(row.clickup_synced_at) : null,
    sampleTrackId: row.sample_track_id ? String(row.sample_track_id) : null,
    sampleStartSeconds: row.sample_start_seconds == null ? null : Number(row.sample_start_seconds),
    sampleEndSeconds: row.sample_end_seconds == null ? null : Number(row.sample_end_seconds),
    sampleObjectKey: row.sample_object_key ? String(row.sample_object_key) : null,
    sampleGeneratedAt: row.sample_generated_at ? String(row.sample_generated_at) : null,
    storageCleanupStatus: (row.storage_cleanup_status as StorageCleanupStatus | null) ?? "pending",
    storageCleanupError: row.storage_cleanup_error ? String(row.storage_cleanup_error) : null,
    processingStatus: row.processing_status as ProcessingStatus,
    isLegacy: !!row.is_legacy,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTrack(row: Row): TrackRecord {
  return {
    id: String(row.id),
    audiobookId: String(row.audiobook_id),
    originalObjectKey: row.original_object_key ? String(row.original_object_key) : null,
    originalFilename: String(row.original_filename),
    originalDetectedTitle: row.original_detected_title ? String(row.original_detected_title) : null,
    originalOrderIndex: Number(row.original_order_index),
    originalSizeBytes: Number(row.original_size_bytes ?? 0),
    originalDurationSeconds: Number(row.original_duration_seconds ?? 0),
    originalBitrateKbps: row.original_bitrate_kbps == null ? null : Number(row.original_bitrate_kbps),
    originalSampleRateHz: row.original_sample_rate_hz == null ? null : Number(row.original_sample_rate_hz),
    originalChannels: row.original_channels == null ? null : Number(row.original_channels),
    finalObjectKey: row.final_object_key ? String(row.final_object_key) : null,
    finalFilename: row.final_filename ? String(row.final_filename) : null,
    finalTitle: row.final_title ? String(row.final_title) : null,
    finalOrderIndex: row.final_order_index == null ? null : Number(row.final_order_index),
    finalSizeBytes: row.final_size_bytes == null ? null : Number(row.final_size_bytes),
    finalDurationSeconds: row.final_duration_seconds == null ? null : Number(row.final_duration_seconds),
    finalBitrateKbps: row.final_bitrate_kbps == null ? null : Number(row.final_bitrate_kbps),
    finalSampleRateHz: row.final_sample_rate_hz == null ? null : Number(row.final_sample_rate_hz),
    finalChannels: row.final_channels == null ? null : Number(row.final_channels),
    titleProvenance: String(row.title_provenance),
    transformationNotes: row.transformation_notes ? String(row.transformation_notes) : null,
    approvalStatus: row.approval_status as TrackApprovalStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class Repository {
  constructor(private readonly db: D1Database) {}

  async createBatch(input: {
    id: string;
    sourceType: SourceType;
    driveLink?: string | null;
    uploadObjectKey?: string | null;
    studioId?: string | null;
  }) {
    const now = nowIso();
    await bindObject(
      this.db.prepare(
        `INSERT INTO ingestion_batch
        (id, source_type, drive_link, upload_object_key, studio_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'ingested', ?, ?)`,
      ),
      [input.id, input.sourceType, input.driveLink ?? null, input.uploadObjectKey ?? null, input.studioId ?? null, now, now],
    ).run();
    return this.getBatch(input.id);
  }

  async getBatch(id: string) {
    const row = await this.db.prepare(`SELECT * FROM ingestion_batch WHERE id = ?`).bind(id).first<Row>();
    return row ? mapBatch(row) : null;
  }

  async listBatches(limit = 50, offset = 0) {
    const result = await this.db.prepare(`SELECT * FROM ingestion_batch ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all<Row>();
    return result.results.map(mapBatch);
  }

  async updateBatch(id: string, patch: Partial<Omit<IngestionBatchRecord, "id" | "createdAt">>) {
    const current = await this.getBatch(id);
    if (!current) return null;
    const next: IngestionBatchRecord = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    await bindObject(
      this.db.prepare(
        `UPDATE ingestion_batch SET
         drive_link = ?, upload_object_key = ?, metadata_sheet_object_key = ?, seller_id = ?, seller_name = ?,
         intake_mode = ?, status = ?, source_manifest_json = ?, normalization_json = ?, report_object_key = ?, updated_at = ?
         WHERE id = ?`,
      ),
      [
        next.driveLink,
        next.uploadObjectKey,
        next.metadataSheetObjectKey,
        next.sellerId,
        next.sellerName,
        next.intakeMode,
        next.status,
        JSON.stringify(next.sourceManifest),
        JSON.stringify(next.normalization),
        next.reportObjectKey,
        next.updatedAt,
        id,
      ],
    ).run();
    return next;
  }

  async replaceCandidates(batchId: string, rows: Array<Omit<CandidateRecord, "createdAt" | "updatedAt">>) {
    await this.db.prepare(`DELETE FROM ingestion_candidate WHERE batch_id = ?`).bind(batchId).run();
    const now = nowIso();
    const statements = rows.map((row) =>
      bindObject(
        this.db.prepare(
          `INSERT INTO ingestion_candidate
          (id, batch_id, metadata_row_index, title, author, subtitle, isbn, narrator, source_group_key, source_group_json,
           samawy_candidates_json, classification_decision, decision_reason, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ),
        [
          row.id,
          row.batchId,
          row.metadataRowIndex,
          row.title,
          row.author,
          row.subtitle,
          row.isbn,
          row.narrator,
          row.sourceGroupKey,
          JSON.stringify(row.sourceGroup),
          JSON.stringify(row.samawyCandidates),
          row.classificationDecision,
          row.decisionReason,
          row.status,
          now,
          now,
        ],
      ),
    );
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  async listCandidates(batchId: string) {
    const result = await this.db
      .prepare(`SELECT * FROM ingestion_candidate WHERE batch_id = ? ORDER BY metadata_row_index ASC, title ASC`)
      .bind(batchId)
      .all<Row>();
    return result.results.map(mapCandidate);
  }

  async getCandidate(id: string) {
    const row = await this.db.prepare(`SELECT * FROM ingestion_candidate WHERE id = ?`).bind(id).first<Row>();
    return row ? mapCandidate(row) : null;
  }

  async updateCandidateDecision(id: string, decision: CandidateDecision, reason: string) {
    await this.db
      .prepare(
        `UPDATE ingestion_candidate SET classification_decision = ?, decision_reason = ?, status = 'reviewed', updated_at = ? WHERE id = ?`,
      )
      .bind(decision, reason, nowIso(), id)
      .run();
  }

  async updateCandidateSourceGroup(id: string, sourceGroupKey: string | null, sourceGroup: NormalizedGroup | null) {
    await this.db
      .prepare(
        `UPDATE ingestion_candidate SET source_group_key = ?, source_group_json = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(sourceGroupKey, JSON.stringify(sourceGroup), nowIso(), id)
      .run();
  }

  async updateCandidateMetadataOverride(id: string, override: Partial<MetadataRow>) {
    await this.db
      .prepare(`UPDATE ingestion_candidate SET metadata_override_json = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(override), nowIso(), id)
      .run();
  }

  async createAudiobook(record: Omit<AudiobookRecord, "createdAt" | "updatedAt">) {
    const now = nowIso();
    await bindObject(
      this.db.prepare(
        `INSERT INTO audiobook_record
        (id, batch_id, candidate_id, publisher_id, publisher_name, title, subtitle, genre, blurb, author, narrator, isbn,
         pub_year, selling_type, price, track_count, total_length_seconds, total_original_size_bytes, total_final_size_bytes,
         mp3_specs_summary, source_drive_link, importance_points, classification_decision, metadata_snapshot_json, storage_base_path,
         cover_status, cover_object_key, dossier_status, dossier_workbook_key, dossier_audio_zip_key, clickup_task_id, clickup_task_url,
         clickup_sync_status, clickup_sync_error, clickup_synced_at, sample_track_id, sample_start_seconds, sample_end_seconds,
         sample_object_key, sample_generated_at, storage_cleanup_status, storage_cleanup_error, processing_status, is_legacy, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      [
        record.id,
        record.batchId,
        record.candidateId,
        record.publisherId,
        record.publisherName,
        record.title,
        record.subtitle,
        record.genre,
        record.blurb,
        record.author,
        record.narrator,
        record.isbn,
        record.pubYear,
        record.sellingType,
        record.price,
        record.trackCount,
        record.totalLengthSeconds,
        record.totalOriginalSizeBytes,
        record.totalFinalSizeBytes,
        JSON.stringify(record.mp3SpecsSummary),
        record.sourceDriveLink,
        record.importancePoints,
        record.classificationDecision,
        JSON.stringify(record.metadataSnapshot),
        record.storageBasePath,
        record.coverStatus,
        record.coverObjectKey,
        record.dossierStatus,
        record.dossierWorkbookKey,
        record.dossierAudioZipKey,
        record.clickupTaskId,
        record.clickupTaskUrl,
        record.clickupSyncStatus,
        record.clickupSyncError,
        record.clickupSyncedAt,
        record.sampleTrackId,
        record.sampleStartSeconds,
        record.sampleEndSeconds,
        record.sampleObjectKey,
        record.sampleGeneratedAt,
        record.storageCleanupStatus,
        record.storageCleanupError,
        record.processingStatus,
        record.isLegacy ? 1 : 0,
        now,
        now,
      ],
    ).run();
    return this.getAudiobook(record.id);
  }

  async listAudiobooks(limit = 100, offset = 0) {
    const result = await this.db.prepare(`SELECT * FROM audiobook_record ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all<Row>();
    return result.results.map(mapAudiobook);
  }

  async listAudiobooksByBatch(batchId: string) {
    const result = await this.db
      .prepare(`SELECT * FROM audiobook_record WHERE batch_id = ? ORDER BY created_at DESC`)
      .bind(batchId)
      .all<Row>();
    return result.results.map(mapAudiobook);
  }

  async deleteAudiobookAndTracks(id: string) {
    await this.db.batch([
      this.db.prepare(`DELETE FROM track_record WHERE audiobook_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM processing_run WHERE audiobook_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM artifact_record WHERE audiobook_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM audiobook_record WHERE id = ?`).bind(id),
    ]);
  }

  async deleteBatch(id: string) {
    await this.db.batch([
      this.db.prepare(`DELETE FROM ingestion_candidate WHERE batch_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM ingestion_batch WHERE id = ?`).bind(id),
    ]);
  }

  async deleteOperatorUser(email: string) {
    await this.db.prepare(`DELETE FROM operator_user WHERE email = ?`).bind(email).run();
  }

  async getAudiobook(id: string) {
    const row = await this.db.prepare(`SELECT * FROM audiobook_record WHERE id = ?`).bind(id).first<Row>();
    return row ? mapAudiobook(row) : null;
  }

  async updateAudiobook(id: string, patch: Partial<AudiobookRecord>) {
    const current = await this.getAudiobook(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await bindObject(
      this.db.prepare(
        `UPDATE audiobook_record SET
          publisher_name = ?, title = ?, subtitle = ?, genre = ?, blurb = ?, author = ?, narrator = ?, isbn = ?,
          pub_year = ?, selling_type = ?, price = ?, track_count = ?, total_length_seconds = ?, total_original_size_bytes = ?,
          total_final_size_bytes = ?, mp3_specs_summary = ?, source_drive_link = ?, importance_points = ?, classification_decision = ?,
          metadata_snapshot_json = ?, storage_base_path = ?, cover_status = ?, cover_object_key = ?, dossier_status = ?, dossier_workbook_key = ?,
          dossier_audio_zip_key = ?, clickup_task_id = ?, clickup_task_url = ?, clickup_sync_status = ?, clickup_sync_error = ?,
          clickup_synced_at = ?, sample_track_id = ?, sample_start_seconds = ?, sample_end_seconds = ?, sample_object_key = ?,
          sample_generated_at = ?, storage_cleanup_status = ?, storage_cleanup_error = ?, processing_status = ?, updated_at = ?
          WHERE id = ?`,
      ),
      [
        next.publisherName,
        next.title,
        next.subtitle,
        next.genre,
        next.blurb,
        next.author,
        next.narrator,
        next.isbn,
        next.pubYear,
        next.sellingType,
        next.price,
        next.trackCount,
        next.totalLengthSeconds,
        next.totalOriginalSizeBytes,
        next.totalFinalSizeBytes,
        JSON.stringify(next.mp3SpecsSummary),
        next.sourceDriveLink,
        next.importancePoints,
        next.classificationDecision,
        JSON.stringify(next.metadataSnapshot),
        next.storageBasePath,
        next.coverStatus,
        next.coverObjectKey,
        next.dossierStatus,
        next.dossierWorkbookKey,
        next.dossierAudioZipKey,
        next.clickupTaskId,
        next.clickupTaskUrl,
        next.clickupSyncStatus,
        next.clickupSyncError,
        next.clickupSyncedAt,
        next.sampleTrackId,
        next.sampleStartSeconds,
        next.sampleEndSeconds,
        next.sampleObjectKey,
        next.sampleGeneratedAt,
        next.storageCleanupStatus,
        next.storageCleanupError,
        next.processingStatus,
        next.updatedAt,
        id,
      ],
    ).run();
    return next;
  }

  async replaceTracks(audiobookId: string, rows: Array<Omit<TrackRecord, "createdAt" | "updatedAt">>) {
    await this.db.prepare(`DELETE FROM track_record WHERE audiobook_id = ?`).bind(audiobookId).run();
    const now = nowIso();
    const statements = rows.map((row) =>
      bindObject(
        this.db.prepare(
          `INSERT INTO track_record
          (id, audiobook_id, original_object_key, original_filename, original_detected_title, original_order_index, original_size_bytes,
           original_duration_seconds, original_bitrate_kbps, original_sample_rate_hz, original_channels, final_object_key, final_filename,
           final_title, final_order_index, final_size_bytes, final_duration_seconds, final_bitrate_kbps, final_sample_rate_hz,
           final_channels, title_provenance, transformation_notes, approval_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ),
        [
          row.id,
          row.audiobookId,
          row.originalObjectKey,
          row.originalFilename,
          row.originalDetectedTitle,
          row.originalOrderIndex,
          row.originalSizeBytes,
          row.originalDurationSeconds,
          row.originalBitrateKbps,
          row.originalSampleRateHz,
          row.originalChannels,
          row.finalObjectKey,
          row.finalFilename,
          row.finalTitle,
          row.finalOrderIndex,
          row.finalSizeBytes,
          row.finalDurationSeconds,
          row.finalBitrateKbps,
          row.finalSampleRateHz,
          row.finalChannels,
          row.titleProvenance,
          row.transformationNotes,
          row.approvalStatus,
          now,
          now,
        ],
      ),
    );
    await this.db.batch(statements);
  }

  async listTracks(audiobookId: string) {
    const result = await this.db
      .prepare(`SELECT * FROM track_record WHERE audiobook_id = ? ORDER BY original_order_index ASC`)
      .bind(audiobookId)
      .all<Row>();
    return result.results.map(mapTrack);
  }

  async updateTrackApprovals(audiobookId: string, updates: Array<{ id: string; finalTitle: string; finalOrderIndex: number }>) {
    const statements = updates.map((update) =>
      this.db
        .prepare(
          `UPDATE track_record SET final_title = ?, final_order_index = ?, approval_status = 'approved', updated_at = ? WHERE id = ? AND audiobook_id = ?`,
        )
        .bind(update.finalTitle, update.finalOrderIndex, nowIso(), update.id, audiobookId),
    );
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  async updateSampleSelection(audiobookId: string, selection: SampleSelection) {
    await this.db
      .prepare(
        `UPDATE audiobook_record
         SET sample_track_id = ?, sample_start_seconds = ?, sample_end_seconds = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(selection.trackId, selection.startSeconds, selection.endSeconds, nowIso(), audiobookId)
      .run();
  }

  async applyProcessingTracks(
    audiobookId: string,
    updates: Array<{
      originalFilename: string;
      originalSizeBytes: number;
      originalDurationSeconds: number;
      originalBitrateKbps?: number;
      originalSampleRateHz?: number;
      originalChannels?: number;
      finalObjectKey?: string;
      finalFilename?: string;
      finalTitle?: string;
      finalSizeBytes?: number;
      finalDurationSeconds?: number;
      finalBitrateKbps?: number;
      finalSampleRateHz?: number;
      finalChannels?: number;
      notes?: string;
    }>,
  ) {
    const statements = updates.map((update) =>
      this.db
        .prepare(
          `UPDATE track_record SET
            original_size_bytes = ?, original_duration_seconds = ?, original_bitrate_kbps = ?, original_sample_rate_hz = ?, original_channels = ?,
            final_object_key = ?, final_filename = ?, final_title = COALESCE(?, final_title), final_size_bytes = ?, final_duration_seconds = ?,
            final_bitrate_kbps = ?, final_sample_rate_hz = ?, final_channels = ?, transformation_notes = ?, updated_at = ?
           WHERE audiobook_id = ? AND original_filename = ?`,
        )
        .bind(
          update.originalSizeBytes,
          update.originalDurationSeconds,
          update.originalBitrateKbps ?? null,
          update.originalSampleRateHz ?? null,
          update.originalChannels ?? null,
          update.finalObjectKey ?? null,
          update.finalFilename ?? null,
          update.finalTitle ?? null,
          update.finalSizeBytes ?? null,
          update.finalDurationSeconds ?? null,
          update.finalBitrateKbps ?? null,
          update.finalSampleRateHz ?? null,
          update.finalChannels ?? null,
          update.notes ?? null,
          nowIso(),
          audiobookId,
          update.originalFilename,
        ),
    );
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  async createProcessingRun(id: string, audiobookId: string, requestJson: string) {
    const now = nowIso();
    await this.db
      .prepare(
        `INSERT INTO processing_run (id, audiobook_id, status, request_json, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)`,
      )
      .bind(id, audiobookId, requestJson, now, now)
      .run();
  }

  async updateProcessingRun(id: string, input: { status: string; result?: ProcessingJobResult; error?: unknown; containerInstance?: string }) {
    await this.db
      .prepare(
        `UPDATE processing_run SET status = ?, result_json = ?, error_json = ?, container_instance = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        input.status,
        input.result ? JSON.stringify(input.result) : null,
        input.error ? JSON.stringify(input.error) : null,
        input.containerInstance ?? null,
        nowIso(),
        id,
      )
      .run();
  }

  async putArtifact(id: string, input: {
    batchId?: string | null;
    audiobookId?: string | null;
    artifactType: string;
    descriptor: ArtifactDescriptor;
  }) {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO artifact_record
         (id, batch_id, audiobook_id, artifact_type, object_key, content_type, size_bytes, checksum, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.batchId ?? null,
        input.audiobookId ?? null,
        input.artifactType,
        input.descriptor.key,
        input.descriptor.contentType ?? null,
        input.descriptor.sizeBytes ?? null,
        input.descriptor.checksum ?? null,
        JSON.stringify(input.descriptor.metadata ?? {}),
        nowIso(),
      )
      .run();
  }

  async listProcessingRuns(audiobookId?: string) {
    let result;
    if (audiobookId) {
      result = await this.db
        .prepare(`SELECT * FROM processing_run WHERE audiobook_id = ? ORDER BY created_at DESC`)
        .bind(audiobookId)
        .all<Row>();
    } else {
      result = await this.db
        .prepare(`SELECT * FROM processing_run ORDER BY created_at DESC LIMIT 100`)
        .all<Row>();
    }
    return result.results.map((row) => ({
      id: String(row.id),
      audiobookId: String(row.audiobook_id),
      containerInstance: row.container_instance ? String(row.container_instance) : null,
      status: String(row.status),
      requestJson: String(row.request_json),
      resultJson: row.result_json ? String(row.result_json) : null,
      errorJson: row.error_json ? String(row.error_json) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  async listArtifacts(input?: { audiobookId?: string; batchId?: string; artifactType?: string }) {
    let sql = `SELECT * FROM artifact_record WHERE 1=1`;
    const params: Array<string> = [];
    if (input?.audiobookId) {
      sql += ` AND audiobook_id = ?`;
      params.push(input.audiobookId);
    }
    if (input?.batchId) {
      sql += ` AND batch_id = ?`;
      params.push(input.batchId);
    }
    if (input?.artifactType) {
      sql += ` AND artifact_type = ?`;
      params.push(input.artifactType);
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await this.db.prepare(sql).bind(...params).all<Row>();
    return result.results.map((row) => ({
      id: String(row.id),
      batchId: row.batch_id ? String(row.batch_id) : null,
      audiobookId: row.audiobook_id ? String(row.audiobook_id) : null,
      artifactType: String(row.artifact_type),
      objectKey: String(row.object_key),
      contentType: row.content_type ? String(row.content_type) : null,
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      checksum: row.checksum ? String(row.checksum) : null,
      metadataJson: row.metadata_json ? String(row.metadata_json) : "{}",
      createdAt: String(row.created_at),
    }));
  }

  async audit(resourceType: string, resourceId: string, action: string, actor: string, detail: unknown) {
    await this.db
      .prepare(
        `INSERT INTO audit_event (id, resource_type, resource_id, action, actor, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), resourceType, resourceId, action, actor, JSON.stringify(detail), nowIso())
      .run();
  }

  async listAuditEvents(resourceType: string, resourceId: string, limit = 100) {
    const result = await this.db
      .prepare(
        `SELECT * FROM audit_event WHERE resource_type = ? AND resource_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(resourceType, resourceId, limit)
      .all<Row>();
    return result.results.map((row) => ({
      id: String(row.id),
      resourceType: String(row.resource_type),
      resourceId: String(row.resource_id),
      action: String(row.action),
      actor: String(row.actor),
      detailJson: row.detail_json ? String(row.detail_json) : null,
      createdAt: String(row.created_at),
    }));
  }

  // ─── Operator Auth ─────────────────────────────────────────────────

  async getOperatorUser(email: string) {
    const row = await this.db.prepare(`SELECT * FROM operator_user WHERE email = ?`).bind(email).first<Row>();
    if (!row) return null;
    let permissions: import("./types").UserPermission[] = [];
    try { permissions = JSON.parse(String(row.permissions_json || '[]')); } catch { /* ignore */ }
    return {
      email: String(row.email),
      name: row.name ? String(row.name) : null,
      permissions,
      isActive: Boolean(row.is_active),
      passwordHash: row.password_hash ? String(row.password_hash) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async setPasswordHash(email: string, hash: string): Promise<void> {
    await this.db
      .prepare(`UPDATE operator_user SET password_hash = ?, updated_at = ? WHERE email = ?`)
      .bind(hash, nowIso(), email)
      .run();
  }

  async listOperatorUsers(limit = 100, offset = 0) {
    const result = await this.db.prepare(`SELECT * FROM operator_user ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all<Row>();
    return result.results.map((row) => {
      let permissions: import("./types").UserPermission[] = [];
      try { permissions = JSON.parse(String(row.permissions_json || '[]')); } catch { /* ignore */ }
      return {
        email: String(row.email),
        name: row.name ? String(row.name) : null,
        permissions,
        isActive: Boolean(row.is_active),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }

  async upsertOperatorUser(input: { email: string; name?: string | null; permissions: import("./types").UserPermission[]; isActive?: boolean }) {
    const now = nowIso();
    const permJson = JSON.stringify(input.permissions);
    const existing = await this.getOperatorUser(input.email);
    if (existing) {
      await this.db
        .prepare(`UPDATE operator_user SET name = ?, permissions_json = ?, is_active = ?, updated_at = ? WHERE email = ?`)
        .bind(input.name ?? existing.name, permJson, (input.isActive ?? existing.isActive) ? 1 : 0, now, input.email)
        .run();
    } else {
      await this.db
        .prepare(`INSERT INTO operator_user (email, name, role, permissions_json, is_active, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?, ?, ?)`)
        .bind(input.email, input.name ?? null, permJson, input.isActive !== false ? 1 : 0, now, now)
        .run();
    }
    return this.getOperatorUser(input.email);
  }

  async createOperatorInvite(input: { id: string; email: string; role: string; invitedBy: string; token: string; expiresAt: string }) {
    await this.db
      .prepare(`INSERT INTO operator_invite (id, email, role, invited_by, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.id, input.email, input.role, input.invitedBy, input.token, input.expiresAt, nowIso())
      .run();
  }

  async getOperatorInviteByToken(token: string) {
    const row = await this.db.prepare(`SELECT * FROM operator_invite WHERE token = ?`).bind(token).first<Row>();
    if (!row) return null;
    return {
      id: String(row.id),
      email: String(row.email),
      role: String(row.role),
      invitedBy: String(row.invited_by),
      token: String(row.token),
      expiresAt: String(row.expires_at),
      usedAt: row.used_at ? String(row.used_at) : null,
      createdAt: String(row.created_at),
    };
  }

  async markInviteUsed(token: string) {
    await this.db
      .prepare(`UPDATE operator_invite SET used_at = ? WHERE token = ?`)
      .bind(nowIso(), token)
      .run();
  }

  async logOperatorAudit(input: { actorEmail: string; action: string; resourceType: string; resourceId?: string; details?: unknown }) {
    await this.db
      .prepare(
        `INSERT INTO operator_audit_log (id, actor_email, action, resource_type, resource_id, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.actorEmail, input.action, input.resourceType, input.resourceId ?? null, JSON.stringify(input.details ?? {}), nowIso())
      .run();
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async upsertSetting(key: string, value: string): Promise<void> {
    await this.db
      .prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(key, value, nowIso())
      .run();
  }

  async deleteSetting(key: string): Promise<void> {
    await this.db.prepare(`DELETE FROM app_settings WHERE key = ?`).bind(key).run();
  }

  // ─── Studios ────────────────────────────────────────────────────────────────

  async createStudio(input: { id: string; name: string; slug: string; contactEmail: string; createdBy: string }) {
    await this.db.prepare(
      `INSERT INTO studio (id, name, slug, contact_email, is_active, created_by) VALUES (?, ?, ?, ?, 1, ?)`
    ).bind(input.id, input.name, input.slug, input.contactEmail, input.createdBy).run();
    // The primary contact is also a manageable studio user.
    await this.addStudioContact(input.id, input.contactEmail).catch(() => undefined);
    return this.getStudio(input.id);
  }

  // ─── Studio contacts (login users) ──────────────────────────────────────────
  async listStudioContacts(studioId: string) {
    const { results } = await this.db
      .prepare(`SELECT * FROM studio_contact WHERE studio_id = ? ORDER BY created_at ASC`)
      .bind(studioId).all<StudioContactRow>();
    return results;
  }

  async addStudioContact(studioId: string, email: string, name?: string | null) {
    const id = crypto.randomUUID();
    await this.db
      .prepare(`INSERT OR IGNORE INTO studio_contact (id, studio_id, email, name) VALUES (?, ?, ?, ?)`)
      .bind(id, studioId, email.trim().toLowerCase(), name ?? null).run();
    return id;
  }

  async deleteStudioContact(studioId: string, contactId: string) {
    await this.db.prepare(`DELETE FROM studio_contact WHERE id = ? AND studio_id = ?`).bind(contactId, studioId).run();
  }

  // ─── Legacy productions ─────────────────────────────────────────────────────
  async createLegacyProduction(input: { studioId: string; bookTitle: string; isbn?: string | null; narrator?: string | null; netHours?: number | null; notes?: string | null }) {
    const id = crypto.randomUUID();
    await this.db
      .prepare(`INSERT INTO studio_legacy_production (id, studio_id, book_title, isbn, narrator, net_hours, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.studioId, input.bookTitle, input.isbn ?? null, input.narrator ?? null, input.netHours ?? null, input.notes ?? null).run();
    return id;
  }

  async listLegacyProductions(studioId: string) {
    const { results } = await this.db
      .prepare(`SELECT * FROM studio_legacy_production WHERE studio_id = ? ORDER BY created_at DESC`)
      .bind(studioId).all<StudioLegacyProductionRow>();
    return results;
  }

  async updateLegacyProduction(studioId: string, id: string, patch: { bookTitle?: string; isbn?: string | null; narrator?: string | null; netHours?: number | null; notes?: string | null }) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.bookTitle !== undefined) { fields.push('book_title = ?'); values.push(patch.bookTitle); }
    if ('isbn' in patch) { fields.push('isbn = ?'); values.push(patch.isbn ?? null); }
    if ('narrator' in patch) { fields.push('narrator = ?'); values.push(patch.narrator ?? null); }
    if ('netHours' in patch) { fields.push('net_hours = ?'); values.push(patch.netHours ?? null); }
    if ('notes' in patch) { fields.push('notes = ?'); values.push(patch.notes ?? null); }
    if (!fields.length) return;
    values.push(id, studioId);
    await this.db.prepare(`UPDATE studio_legacy_production SET ${fields.join(', ')} WHERE id = ? AND studio_id = ?`).bind(...values).run();
  }

  async deleteLegacyProduction(studioId: string, id: string) {
    await this.db.prepare(`DELETE FROM studio_legacy_production WHERE id = ? AND studio_id = ?`).bind(id, studioId).run();
  }

  /** True when the email may access the given studio's portal (any contact, or the legacy primary). */
  async isStudioContactEmail(studioId: string, email: string) {
    const norm = email.trim().toLowerCase();
    const row = await this.db
      .prepare(`SELECT 1 AS ok FROM studio_contact WHERE studio_id = ? AND lower(email) = ? LIMIT 1`)
      .bind(studioId, norm).first<{ ok: number }>();
    return !!row;
  }

  async getStudio(id: string) {
    return this.db.prepare(`SELECT * FROM studio WHERE id = ?`).bind(id).first<StudioRow>();
  }

  async getStudioBySlug(slug: string) {
    return this.db.prepare(`SELECT * FROM studio WHERE slug = ?`).bind(slug).first<StudioRow>();
  }

  async listStudios(limit = 100, offset = 0) {
    const { results } = await this.db.prepare(`SELECT * FROM studio ORDER BY name LIMIT ? OFFSET ?`).bind(limit, offset).all<StudioRow>();
    return results;
  }

  /** Per-studio aggregate stats for the studios dashboard, keyed by studio id. */
  async getStudioAggregates(): Promise<Map<string, StudioAggregate>> {
    const map = new Map<string, StudioAggregate>();
    const ensure = (id: string) => {
      let v = map.get(id);
      if (!v) { v = { contacts: 0, productionFiles: 0, assignedFiles: 0, samplesTotal: 0, samplesPending: 0, samplesApproved: 0, samplesRefused: 0, deliveries: 0, deliveriesCompleted: 0, netFinalHours: 0, legacyProductions: 0, legacyNetHours: 0 }; map.set(id, v); }
      return v;
    };
    const [contacts, files, samples, deliveries, legacy] = await Promise.all([
      this.db.prepare(`SELECT studio_id, COUNT(*) AS c FROM studio_contact GROUP BY studio_id`).all<{ studio_id: string; c: number }>(),
      this.db.prepare(`SELECT studio_id, COUNT(*) AS total, SUM(CASE WHEN audiobook_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned FROM studio_production_file GROUP BY studio_id`).all<{ studio_id: string; total: number; assigned: number }>(),
      this.db.prepare(`SELECT studio_id, status, COUNT(*) AS c FROM studio_sample GROUP BY studio_id, status`).all<{ studio_id: string; status: string; c: number }>(),
      this.db.prepare(`SELECT studio_id, COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed, COALESCE(SUM(net_final_hours),0) AS net_hours FROM studio_drive_upload GROUP BY studio_id`).all<{ studio_id: string; total: number; completed: number; net_hours: number }>(),
      this.db.prepare(`SELECT studio_id, COUNT(*) AS total, COALESCE(SUM(net_hours),0) AS net_hours FROM studio_legacy_production GROUP BY studio_id`).all<{ studio_id: string; total: number; net_hours: number }>(),
    ]);
    for (const r of contacts.results) ensure(r.studio_id).contacts = Number(r.c);
    for (const r of files.results) { const v = ensure(r.studio_id); v.productionFiles = Number(r.total); v.assignedFiles = Number(r.assigned); }
    for (const r of samples.results) {
      const v = ensure(r.studio_id); const c = Number(r.c); v.samplesTotal += c;
      if (r.status === 'pending') v.samplesPending += c;
      else if (r.status === 'approved') v.samplesApproved += c;
      else if (r.status === 'refused') v.samplesRefused += c;
    }
    for (const r of deliveries.results) { const v = ensure(r.studio_id); v.deliveries = Number(r.total); v.deliveriesCompleted = Number(r.completed); v.netFinalHours = Number(r.net_hours); }
    for (const r of legacy.results) { const v = ensure(r.studio_id); v.legacyProductions = Number(r.total); v.legacyNetHours = Number(r.net_hours); }
    return map;
  }

  async updateStudio(id: string, patch: Partial<{ name: string; slug: string; contactEmail: string; logoObjectKey: string | null; isActive: number; hourlyRateUsd: number | null }>) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
    if (patch.slug !== undefined) { fields.push("slug = ?"); values.push(patch.slug); }
    if (patch.contactEmail !== undefined) { fields.push("contact_email = ?"); values.push(patch.contactEmail); }
    if ("hourlyRateUsd" in patch) { fields.push("hourly_rate_usd = ?"); values.push(patch.hourlyRateUsd ?? null); }
    if ("logoObjectKey" in patch) { fields.push("logo_object_key = ?"); values.push(patch.logoObjectKey ?? null); }
    if (patch.isActive !== undefined) { fields.push("is_active = ?"); values.push(patch.isActive); }
    if (!fields.length) return;
    values.push(id);
    await this.db.prepare(`UPDATE studio SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  }

  async deleteStudio(id: string) {
    await this.db.prepare(`DELETE FROM studio WHERE id = ?`).bind(id).run();
  }

  async createStudioMagicLink(studioId: string, token: string, expiresAt: string) {
    await this.db.prepare(
      `INSERT INTO studio_magic_link (id, studio_id, token, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), studioId, token, expiresAt).run();
  }

  async verifyAndConsumeStudioMagicLink(token: string): Promise<{ studioId: string } | null> {
    const row = await this.db.prepare(
      `SELECT id, studio_id, expires_at, used_at FROM studio_magic_link WHERE token = ?`
    ).bind(token).first<{ id: string; studio_id: string; expires_at: string; used_at: string | null }>();
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    await this.db.prepare(`UPDATE studio_magic_link SET used_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
    return { studioId: row.studio_id };
  }

  async createStudioAsset(input: { studioId: string; name: string; objectKey: string; contentType: string; sizeBytes: number; uploadedBy: string }) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO studio_asset (id, studio_id, name, object_key, content_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.studioId, input.name, input.objectKey, input.contentType, input.sizeBytes, input.uploadedBy).run();
    return id;
  }

  async listStudioAssets(studioId: string) {
    const { results } = await this.db.prepare(`SELECT * FROM studio_asset WHERE studio_id = ? ORDER BY created_at DESC`).bind(studioId).all<StudioAssetRow>();
    return results;
  }

  async deleteStudioAsset(id: string) {
    return this.db.prepare(`DELETE FROM studio_asset WHERE id = ? RETURNING object_key`).bind(id).first<{ object_key: string }>();
  }

  async createStudioProductionFile(input: { studioId: string; name: string; objectKey: string; contentType: string; sizeBytes: number; uploadedBy: string }) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO studio_production_file (id, studio_id, name, object_key, content_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.studioId, input.name, input.objectKey, input.contentType, input.sizeBytes, input.uploadedBy).run();
    return id;
  }

  async listStudioProductionFiles(studioId: string) {
    const { results } = await this.db.prepare(`SELECT * FROM studio_production_file WHERE studio_id = ? ORDER BY created_at DESC`).bind(studioId).all<StudioProductionFileRow>();
    return results;
  }

  async deleteStudioProductionFile(id: string) {
    return this.db.prepare(`DELETE FROM studio_production_file WHERE id = ? RETURNING object_key`).bind(id).first<{ object_key: string }>();
  }

  async getStudioProductionFile(id: string) {
    return this.db.prepare(`SELECT * FROM studio_production_file WHERE id = ?`).bind(id).first<StudioProductionFileRow>();
  }

  /** Assign (or clear, when audiobookId is null) the catalog title a production file narrates. */
  async setStudioProductionFileAudiobook(id: string, audiobookId: string | null) {
    await this.db.prepare(`UPDATE studio_production_file SET audiobook_id = ? WHERE id = ?`).bind(audiobookId, id).run();
  }

  /** Studio-supplied production plan (filled after sample approval). */
  async setStudioProductionFilePlan(id: string, plan: { narrator: string | null; expectedNetHours: number | null; estimatedFinishHours: number | null }) {
    await this.db
      .prepare(`UPDATE studio_production_file SET narrator = ?, expected_net_hours = ?, estimated_finish_hours = ? WHERE id = ?`)
      .bind(plan.narrator, plan.expectedNetHours, plan.estimatedFinishHours, id).run();
  }

  /** Production files (across all studios) assigned to a given catalog title. */
  async listStudioProductionFilesByAudiobook(audiobookId: string) {
    const { results } = await this.db
      .prepare(`SELECT * FROM studio_production_file WHERE audiobook_id = ? ORDER BY created_at DESC`)
      .bind(audiobookId)
      .all<StudioProductionFileRow>();
    return results;
  }

  /**
   * Bulk studio-linkage signals per audiobook, for deriving unified production
   * stage across the whole catalog without N+1 queries.
   */
  async getProductionLinkageByAudiobook(): Promise<Map<string, { assigned: boolean; sampleState: "none" | "pending" | "approved" | "refused"; delivered: boolean }>> {
    const map = new Map<string, { assigned: boolean; sampleState: "none" | "pending" | "approved" | "refused"; delivered: boolean }>();
    const ensure = (id: string) => {
      let v = map.get(id);
      if (!v) { v = { assigned: false, sampleState: "none", delivered: false }; map.set(id, v); }
      return v;
    };
    const [assigned, deliveries, samples] = await Promise.all([
      this.db.prepare(`SELECT DISTINCT audiobook_id FROM studio_production_file WHERE audiobook_id IS NOT NULL`).all<{ audiobook_id: string }>(),
      this.db.prepare(`SELECT DISTINCT audiobook_id FROM studio_drive_upload WHERE audiobook_id IS NOT NULL AND status = 'completed'`).all<{ audiobook_id: string }>(),
      this.db.prepare(`SELECT pf.audiobook_id AS audiobook_id, s.status AS status FROM studio_sample s JOIN studio_production_file pf ON s.book_id = pf.id WHERE pf.audiobook_id IS NOT NULL`).all<{ audiobook_id: string; status: string }>(),
    ]);
    for (const r of assigned.results) ensure(r.audiobook_id).assigned = true;
    for (const r of deliveries.results) ensure(r.audiobook_id).delivered = true;
    // Sample precedence: approved > pending > refused.
    for (const r of samples.results) {
      const v = ensure(r.audiobook_id);
      if (v.sampleState === "approved") continue;
      if (r.status === "approved") v.sampleState = "approved";
      else if (r.status === "pending") v.sampleState = "pending";
      else if (v.sampleState === "none" && r.status === "refused") v.sampleState = "refused";
    }
    return map;
  }

  async createStudioSample(input: { studioId: string; bookId?: string | null; name: string; objectKey: string; contentType: string; sizeBytes: number }) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO studio_sample (id, studio_id, book_id, name, object_key, content_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.studioId, input.bookId ?? null, input.name, input.objectKey, input.contentType, input.sizeBytes).run();
    return id;
  }

  async listStudioSamples(studioId: string) {
    const { results } = await this.db.prepare(`SELECT * FROM studio_sample WHERE studio_id = ? ORDER BY created_at DESC`).bind(studioId).all<StudioSampleRow>();
    return results;
  }

  async reviewStudioSample(id: string, status: "approved" | "refused", reviewedBy: string, reviewNote: string | null) {
    await this.db.prepare(
      `UPDATE studio_sample SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ? WHERE id = ?`
    ).bind(status, reviewedBy, reviewNote ?? null, nowIso(), id).run();
  }

  async getStudioSample(id: string) {
    return this.db.prepare(`SELECT * FROM studio_sample WHERE id = ?`).bind(id).first<StudioSampleRow>();
  }

  async createDriveUpload(input: { studioId: string; name: string; objectKey: string; audiobookId?: string | null; netFinalHours?: number | null; notes?: string | null }) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO studio_drive_upload (id, studio_id, name, object_key, audiobook_id, net_final_hours, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.studioId, input.name, input.objectKey, input.audiobookId ?? null, input.netFinalHours ?? null, input.notes ?? null).run();
    return id;
  }

  async getDriveUpload(id: string) {
    return this.db.prepare(`SELECT * FROM studio_drive_upload WHERE id = ?`).bind(id).first<StudioDriveUploadRow>();
  }

  async updateDriveUpload(id: string, patch: { status: string; driveFileId?: string | null; error?: string | null }) {
    await this.db.prepare(
      `UPDATE studio_drive_upload SET status = ?, drive_file_id = ?, error = ? WHERE id = ?`
    ).bind(patch.status, patch.driveFileId ?? null, patch.error ?? null, id).run();
  }

  async listDriveUploads(studioId: string) {
    const { results } = await this.db.prepare(`SELECT * FROM studio_drive_upload WHERE studio_id = ? ORDER BY created_at DESC`).bind(studioId).all<StudioDriveUploadRow>();
    return results;
  }

  async deleteDriveUpload(id: string) {
    await this.db.prepare(`DELETE FROM studio_drive_upload WHERE id = ?`).bind(id).run();
  }

  /** Link a set of a studio's drive uploads to the intake batch that will process them. */
  async linkDriveUploadsToBatch(uploadIds: string[], batchId: string) {
    if (uploadIds.length === 0) return;
    const placeholders = uploadIds.map(() => "?").join(", ");
    await this.db
      .prepare(`UPDATE studio_drive_upload SET batch_id = ? WHERE id IN (${placeholders})`)
      .bind(batchId, ...uploadIds)
      .run();
  }

  // ─── Acquisition users ───────────────────────────────────────────────────────

  async createAcquisitionUser(input: { email: string; name: string; createdBy: string }) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO acquisition_user (id, email, name, created_by) VALUES (?, ?, ?, ?)`
    ).bind(id, input.email, input.name, input.createdBy).run();
    return id;
  }

  async getAcquisitionUser(id: string) {
    return this.db.prepare(`SELECT * FROM acquisition_user WHERE id = ?`).bind(id).first<AcquisitionUserRow>();
  }

  async getAcquisitionUserByEmail(email: string) {
    return this.db.prepare(`SELECT * FROM acquisition_user WHERE email = ?`).bind(email).first<AcquisitionUserRow>();
  }

  async listAcquisitionUsers() {
    const { results } = await this.db.prepare(`SELECT * FROM acquisition_user ORDER BY name`).all<AcquisitionUserRow>();
    return results;
  }

  async updateAcquisitionUser(id: string, patch: Partial<{ name: string; isActive: number }>) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
    if (patch.isActive !== undefined) { fields.push("is_active = ?"); values.push(patch.isActive); }
    if (!fields.length) return;
    values.push(id);
    await this.db.prepare(`UPDATE acquisition_user SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  }

  async createAcquisitionMagicLink(acquisitionUserId: string, token: string, expiresAt: string) {
    await this.db.prepare(
      `INSERT INTO acquisition_magic_link (id, acquisition_user_id, token, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), acquisitionUserId, token, expiresAt).run();
  }

  async verifyAndConsumeAcquisitionMagicLink(token: string): Promise<{ acquisitionUserId: string } | null> {
    const row = await this.db.prepare(
      `SELECT id, acquisition_user_id, expires_at, used_at FROM acquisition_magic_link WHERE token = ?`
    ).bind(token).first<{ id: string; acquisition_user_id: string; expires_at: string; used_at: string | null }>();
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    await this.db.prepare(`UPDATE acquisition_magic_link SET used_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
    return { acquisitionUserId: row.acquisition_user_id };
  }
}
