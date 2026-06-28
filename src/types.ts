import type {
  SourceType,
  UserPermission,
  OperatorUser,
  SourceManifestItem,
  NormalizedGroup,
  ClickUpConfig,
  ClickUpFieldMappings,
  ClickUpDescriptionTemplate,
} from "./api-contracts";
export type {
  SourceType,
  UserPermission,
  OperatorUser,
  SourceManifestItem,
  NormalizedGroup,
  ClickUpConfig,
  ClickUpFieldMappings,
  ClickUpDescriptionTemplate,
};
export { ALL_PERMISSIONS } from "./api-contracts";
export type IntakeMode =
  | "single_book_zip"
  | "multi_book_zip_batch"
  | "book_subfolders_with_zip"
  | "book_subfolders_with_tracks"
  | "flat_tracks_single_book"
  | "mixed_delivery_batch"
  | "ambiguous_source";

export type BatchStatus =
  | "ingested"
  | "intake_queued"
  | "normalizing"
  | "intake_failed"
  | "normalized"
  | "metadata_sheet_pending"
  | "metadata_sheet_selected"
  | "parsing_metadata"
  | "metadata_parsed"
  | "seller_locked"
  | "reconciliation_in_review"
  | "reconciliation_approved"
  | "records_created";

export type CandidateDecision =
  | "approved_existing"
  | "approved_new"
  | "parked_missing_files"
  | "parked_missing_metadata"
  | "parked_needs_business_review"
  | "excluded_extra_source"
  | "excluded_duplicate_source"
  | "excluded_non_book_artifact";

export type CandidateStatus = "pending" | "reviewed";

export type ProcessingStatus = "pending" | "queued" | "running" | "failed" | "succeeded";
export type DossierStatus = "pending" | "sample_pending" | "generating" | "ready" | "failed";
export type TrackApprovalStatus = "pending" | "approved";
export type ClickUpSyncStatus = "never_synced" | "syncing" | "synced" | "failed";
export type StorageCleanupStatus = "pending" | "completed" | "failed";

export interface ArtifactDescriptor {
  key: string;
  contentType?: string;
  sizeBytes?: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

// MetadataRow is the backend-extended version (more fields than the API-facing one)
export interface MetadataRow {
  rowIndex: number;
  title: string;
  publisher: string;
  subtitle?: string;
  genre?: string;
  blurb?: string;
  author?: string;
  isbn?: string;
  pubYear?: string;
  sellingType?: "subscription" | "a_la_carte";
  price?: number;
  trackCount?: number;
  totalOriginalBookSizeBytes?: number;
  totalLengthSeconds?: number;
  narrator?: string;
  importancePoints?: number;
}

export interface SampleSelection {
  trackId: string;
  startSeconds: number;
  endSeconds: number;
}

export interface RawWorkbookRow {
  rowNumber: number;
  values: string[];
}

export interface MetadataNormalizationReport {
  mode: "ai" | "heuristic";
  headerRowNumber: number | null;
  columns?: Record<string, { index: number | null; header?: string | null; confidence?: number | null }>;
  headerCells?: Array<{ col: string; index: number; header: string }>;
  rowReports: Array<{
    rowIndex: number;
    confidence?: number | null;
    missingFields: string[];
    unmappedColumns: string[];
    notes: string[];
  }>;
  warnings: string[];
}

export interface SamawySeller {
  id: number;
  name: string;
}

export interface SamawyBookCandidate {
  externalId: string;
  title: string;
  subtitle?: string;
  author?: string;
  isbn?: string;
  narrator?: string;
  publishYear?: string;
  confidence: number;
  reasons: string[];
}

export interface TrackDraft {
  sourceType?: "direct_audio" | "archive_entry";
  originalObjectKey: string;
  originalFilename: string;
  originalDetectedTitle?: string;
  originalOrderIndex: number;
  titleProvenance: "metadata_sheet" | "audio_tag" | "filename" | "generated_placeholder";
  proposedTitle: string;
}

export interface ProcessingJobPayload {
  processingRunId: string;
  audiobookId: string;
  publisherId: number;
  workingPrefix: string;
  targetArtifactPrefix: string;
  targetDossierPrefix: string;
  inputTracks: Array<{
    sourceType: "direct_audio" | "archive_entry";
    originalFilename: string;
    originalObjectKey: string;
    archiveEntryName?: string;
    downloadUrl: string;
    upload: {
      objectKey: string;
      uploadUrl: string;
      multipartStartUrl?: string;
    };
  }>;
  approvedTracks: TrackDraft[];
  apiBaseUrl: string;
  progressCallbackUrl: string;
  trackProgressCallbackUrl: string;
  internalSecret: string;
  accessClientId?: string;
  accessClientSecret?: string;
  maxBookBytes: number;
  maxTrackBytes: number;
}

export interface ProcessingJobResult {
  status: "succeeded" | "failed_retryable" | "failed_blocking" | "cancelled";
  summary: {
    totalOriginalSizeBytes: number;
    totalFinalSizeBytes: number;
    finalAudioZipKey?: string;
  };
  tracks: Array<{
    originalFilename: string;
    originalObjectKey?: string;
    originalSizeBytes: number;
    originalDurationSeconds: number;
    originalBitrateKbps?: number;
    originalSampleRateHz?: number;
    originalChannels?: number;
    finalFilename?: string;
    finalObjectKey?: string;
    finalTitle?: string;
    finalSizeBytes?: number;
    finalDurationSeconds?: number;
    finalBitrateKbps?: number;
    finalSampleRateHz?: number;
    finalChannels?: number;
    notes?: string;
  }>;
  errors?: string[];
}

export interface SampleGenerationPayload {
  audiobookId: string;
  trackId: string;
  sourceObjectKey: string;
  sourceFilename: string;
  startSeconds: number;
  endSeconds: number;
  sampleUpload: {
    objectKey: string;
    uploadUrl: string;
  };
  accessClientId?: string;
  accessClientSecret?: string;
}

export interface Env {
  DB: D1Database;
  ASSET_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  INGEST_QUEUE: Queue<QueueMessage>;
  PROCESSING_WORKFLOW: Workflow;
  DOSSIER_WORKFLOW: Workflow;
  AUDIO_PROCESSOR_CONTAINER: DurableObjectNamespace<AudioProcessorContainer>;
  AI?: Ai;
  APP_ENV: string;
  GOOGLE_DRIVE_API_BASE_URL: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  CLICKUP_API_BASE_URL: string;
  CLICKUP_API_TOKEN?: string;
  CLICKUP_AUDIOBOOKS_LIST_ID: string;
  INTERNAL_API_SECRET: string;
  APP_BASE_URL?: string;
  SAMAWY_DB_PROXY_BASE_URL?: string;
  SAMAWY_DB_PROXY_CLIENT_ID?: string;
  SAMAWY_DB_PROXY_CLIENT_SECRET?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  SOURCE_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  EMAIL?: SendEmail;
}


export type QueueMessage =
  | { type: "drive-intake"; batchId: string }
  | { type: "upload-intake"; batchId: string; manifest: SourceManifestItem[] }
  | { type: "metadata-parse"; batchId: string }
  | { type: "build-intake-report"; batchId: string };
import type { AudioProcessorContainer } from "./container";
