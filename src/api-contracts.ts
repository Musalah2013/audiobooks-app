/**
 * api-contracts.ts — Single source of truth for every API request/response shape.
 *
 * Rules:
 *  - NO Cloudflare Workers or Node.js-specific imports (Env, R2Bucket, etc.)
 *  - NO framework imports (Hono, React, etc.)
 *  - Both backend (src/) and frontend (ui/src/ via @api alias) import from here
 *
 * Adding a field? Do it here. TypeScript will error at every call site that
 * doesn't handle the new field — the compiler becomes your checklist.
 */

// ─── Permissions & Users ──────────────────────────────────────────────────────

export type UserPermission = "intake" | "metadata" | "matching" | "processing" | "dossier" | "users";
export const ALL_PERMISSIONS: UserPermission[] = ["intake", "metadata", "matching", "processing", "dossier", "users"];

export interface OperatorUser {
  email: string;
  name: string | null;
  permissions: UserPermission[];
  isActive: boolean;
  createdAt: string;
}

// ─── Status enums ─────────────────────────────────────────────────────────────

export type SourceType = "drive" | "upload";

export type BatchStatus =
  | "intake_queued" | "normalizing" | "normalized" | "intake_failed"
  | "metadata_sheet_pending" | "metadata_sheet_selected" | "parsing_metadata"
  | "metadata_parsed" | "seller_locked"
  | "reconciliation_in_review" | "reconciliation_approved"
  | "records_created";

export type ProcessingStatus = "pending" | "queued" | "running" | "failed" | "succeeded";
export type DossierStatus = "pending" | "sample_pending" | "generating" | "ready" | "failed";
export type ClickUpSyncStatus = "never_synced" | "syncing" | "synced" | "failed";
export type TrackApprovalStatus = "pending" | "approved";

// ─── Source manifest & groups ─────────────────────────────────────────────────

export interface SourceManifestItem {
  key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  parentPath: string;
  extractedFromKey?: string;
}

export interface NormalizedGroup {
  groupKey: string;
  displayName: string;
  inferredTitle: string;
  items: SourceManifestItem[];
  coverCandidates: SourceManifestItem[];
  confidence: number;
  reasons: string[];
}

export interface MetadataRow {
  rowIndex: number;
  title: string;
  publisher: string;
  subtitle?: string;
  author?: string;
  isbn?: string;
  narrator?: string;
}

// ─── ClickUp config ───────────────────────────────────────────────────────────

export interface ClickUpFieldMappings {
  audiobookTitle: string;
  subtitle: string;
  publisher: string;
  author: string;
  narrator: string;
  isbn: string;
  pubYear: string;
  genre: string;
  blurb: string;
  classification: string;
  processingStatus: string;
  dossierStatus: string;
  trackCount: string;
  totalLengthHours: string;
  importancePoints: string;
  driveUrl: string;
  sellingPrice: string;
  appLink: string;
  workbookUrl: string;
  audioZipUrl: string;
}

export interface ClickUpDescriptionTemplate {
  includeAppLink: boolean;
  includeWorkbookUrl: boolean;
  includeAudioZipUrl: boolean;
  includeClassification: boolean;
  includeCoverStatus: boolean;
}

export interface ClickUpConfig {
  listId: string;
  statusName: string;
  updateExistingTask: boolean;
  attachCover: boolean;
  fieldMappings: ClickUpFieldMappings;
  descriptionTemplate: ClickUpDescriptionTemplate;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface MeResponse {
  user: OperatorUser | null;
}

export interface UsersResponse {
  users: OperatorUser[];
}

export interface BookListItem {
  id: string;
  title: string;
  publisherName: string;
  processingStatus: string;
  dossierStatus: string;
  clickupTaskUrl: string | null;
  clickupSyncStatus: string;
  storageBasePath: string | null;
  isbn: string | null;
  author: string | null;
  narrator: string | null;
  totalOriginalSizeBytes: number;
  /** Unified position across the studio→catalog→processing→dossier→ClickUp chain. */
  productionStage: ProductionStage;
}

// ─── Unified production status ──────────────────────────────────────────────
// One status that spans both the studio graph (assignment, samples, delivery)
// and the core pipeline (processing, dossier, ClickUp sync).

export type ProductionStage =
  | "catalog"        // in catalog, no studio assigned
  | "assigned"       // assigned to a studio, no sample yet
  | "sample_review"  // studio submitted a sample, awaiting operator review
  | "narrating"      // sample approved, studio narrating
  | "delivered"      // finished audio delivered, awaiting processing
  | "processing"     // audio processing running
  | "processed"      // processing succeeded, dossier not yet ready
  | "dossier_ready"  // dossier built, not yet synced
  | "synced"         // synced to ClickUp — done
  | "failed";        // processing or dossier failed

export const PRODUCTION_STAGE_ORDER: ProductionStage[] = [
  "catalog", "assigned", "sample_review", "narrating", "delivered",
  "processing", "processed", "dossier_ready", "synced",
];

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, { en: string; ar: string }> = {
  catalog:       { en: "In catalog",     ar: "في الفهرس" },
  assigned:      { en: "Assigned",       ar: "مُسنَد" },
  sample_review: { en: "Sample review",  ar: "مراجعة عينة" },
  narrating:     { en: "Narrating",      ar: "قيد التسجيل" },
  delivered:     { en: "Delivered",      ar: "تم التسليم" },
  processing:    { en: "Processing",     ar: "قيد المعالجة" },
  processed:     { en: "Processed",      ar: "تمت المعالجة" },
  dossier_ready: { en: "Dossier ready",  ar: "الملف جاهز" },
  synced:        { en: "Synced",         ar: "تمت المزامنة" },
  failed:        { en: "Failed",         ar: "فشل" },
};

export function deriveProductionStage(input: {
  processingStatus: string;
  dossierStatus: string;
  clickupSyncStatus: string;
  assigned: boolean;
  sampleState: "none" | "pending" | "approved" | "refused";
  delivered: boolean;
}): ProductionStage {
  if (input.processingStatus === "failed" || input.dossierStatus === "failed") return "failed";
  if (input.clickupSyncStatus === "synced") return "synced";
  if (input.dossierStatus === "ready") return "dossier_ready";
  if (input.processingStatus === "succeeded") return "processed";
  if (input.processingStatus === "running" || input.processingStatus === "queued") return "processing";
  if (input.delivered) return "delivered";
  if (input.assigned && input.sampleState === "approved") return "narrating";
  if (input.assigned && input.sampleState === "pending") return "sample_review";
  if (input.assigned) return "assigned";
  return "catalog";
}

export interface BooksResponse {
  books: BookListItem[];
}

export interface TrackRecord {
  id: string;
  originalFilename: string;
  originalDetectedTitle: string | null;
  originalSizeBytes: number;
  originalDurationSeconds: number;
  originalBitrateKbps: number | null;
  originalSampleRateHz: number | null;
  originalChannels: number | null;
  finalObjectKey: string | null;
  finalTitle: string | null;
  finalOrderIndex: number | null;
  finalDurationSeconds: number | null;
  finalSizeBytes: number | null;
  finalBitrateKbps: number | null;
  finalSampleRateHz: number | null;
  finalChannels: number | null;
  approvalStatus: string;
  titleProvenance: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  actor?: string;
  createdAt: string;
  detailJson: string | null;
}

export interface BookDetail {
  id: string;
  title: string;
  subtitle: string | null;
  publisherName: string;
  author: string | null;
  narrator: string | null;
  isbn: string | null;
  genre: string | null;
  blurb: string | null;
  pubYear: string | null;
  sellingType: string | null;
  price: number | null;
  processingStatus: string;
  dossierStatus: string;
  clickupTaskUrl: string | null;
  dossierWorkbookKey: string | null;
  dossierAudioZipKey: string | null;
  clickupSyncStatus: string;
  clickupSyncError: string | null;
  sampleTrackId: string | null;
  sampleStartSeconds: number | null;
  sampleEndSeconds: number | null;
  sampleObjectKey: string | null;
  coverObjectKey: string | null;
  storageBasePath: string | null;
}

export interface BookDetailResponse {
  book: BookDetail | null;
  tracks: TrackRecord[];
  processingRun: {
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    errorJson: string | null;
    resultJson: string | null;
  } | null;
  processingEvents: AuditEvent[];
  dossierEvents: AuditEvent[];
  /** Studios narrating this title (via assigned production files). */
  narration?: NarrationLink[];
  /** Unified production stage across the studio + pipeline chain. */
  productionStage?: ProductionStage | null;
}

export interface NarrationLink {
  studioId: string;
  studioName: string | null;
  productionFileId: string;
  productionFileName: string;
}

export interface BatchListItem {
  id: string;
  sourceType: SourceType;
  driveLink: string | null;
  sellerId: number | null;
  sellerName: string | null;
  status: string;
  intakeMode: string | null;
  reportObjectKey: string | null;
  createdAt: string;
}

export interface BatchesResponse {
  batches: BatchListItem[];
}

export interface IntakeProgress {
  phase?: string;
  totalSourceFiles?: number;
  copiedSourceFiles?: number;
  totalSourceBytes?: number;
  copiedSourceBytes?: number;
  totalArchives?: number;
  extractedArchives?: number;
  extractedEntries?: number;
  currentItem?: string | null;
  updatedAt?: string;
  listingFilesFound?: number;
  listingFoldersVisited?: number;
  listingCurrentFolder?: string;
  activeTransfers?: Array<{
    key: string;
    name: string;
    sizeBytes: number;
    downloadedBytes: number;
    progressPercent: number;
  }>;
}

export interface IntakeLog {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface Candidate {
  id: string;
  title: string;
  author: string | null;
  subtitle: string | null;
  isbn: string | null;
  narrator: string | null;
  metadataRowIndex?: number | null;
  sourceGroupKey: string | null;
  sourceGroup?: {
    groupKey: string;
    displayName: string;
    inferredTitle: string;
    items?: Array<{ key: string; name: string }>;
  } | null;
  classificationDecision: string | null;
  decisionReason: string | null;
  metadataOverride: Record<string, unknown> | null;
  samawyCandidates: Array<{ title: string; confidence: number; reasons: string[] }>;
}

export interface Seller {
  id: number;
  name: string;
}

export interface BatchDetailResponse {
  batch: {
    id: string;
    sourceType: SourceType;
    status: string;
    intakeMode: string | null;
    sellerName: string | null;
    sellerId: number | null;
    reportObjectKey: string | null;
    metadataSheetObjectKey: string | null;
    studioId?: string | null;
    studioName?: string | null;
    sourceManifest: SourceManifestItem[];
    normalization: {
      intakeError?: string;
      metadataParseError?: string;
      metadataRows?: MetadataRow[];
      groups?: NormalizedGroup[];
      metadataNormalizationReport?: {
        mode?: string;
        headerRowNumber?: number | null;
        warnings?: string[];
        columns?: Record<string, { index: number | null; header?: string | null; confidence?: number | null }>;
        headerCells?: Array<{ col: string; index: number; header: string }>;
      };
      deferredArchives?: Array<{ key: string; name: string; reason: string }>;
      intakeProgress?: IntakeProgress;
      intakeLogs?: IntakeLog[];
    } | null;
  } | null;
  candidates: Candidate[];
  events: AuditEvent[];
}

export interface AppSettings {
  environment: { appEnv: string; apiBaseUrl: string | null; bucketName: string };
  storage: {
    retainedBytes: number;
    retainedObjects: number;
    retainedGb: number;
    estimatedMonthlyStorageCostUsd: number;
    estimateType: string;
    storageClass: string;
  };
  pricing: {
    verifiedAt: string;
    sourceUrl: string;
    standardStorageUsdPerGbMonth: number;
    infrequentAccessStorageUsdPerGbMonth: number;
    classAUsdPerMillion: Record<string, number>;
    classBUsdPerMillion: Record<string, number>;
    retrievalUsdPerGb: Record<string, number>;
    freeTier: { storageGbMonth: number; classAOps: number; classBOps: number; egress: string };
  };
}

export interface ClickUpSettingsResponse {
  config: ClickUpConfig;
  tokenMasked: string | null;
  tokenSource: "db" | "env" | null;
  defaults: ClickUpConfig;
}

// ─── AI model configuration ─────────────────────────────────────────────────

export type AiModelTier = "economy" | "balanced" | "premium";

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  contextWindow: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  tier: AiModelTier;
}

export interface AiModelConfig {
  /** Model used for workbook column detection (metadata parsing). */
  workbookModelId: string;
}

export interface AiSettingsResponse {
  config: AiModelConfig;
  defaults: AiModelConfig;
  /** Available Cloudflare Workers AI models with published pricing. */
  catalog: AiModelOption[];
  pricing: {
    verifiedAt: string;
    sourceUrl: string;
  };
  /** False when the AI binding is not available in this environment. */
  aiBindingAvailable: boolean;
}

// ─── Studio portal ────────────────────────────────────────────────────────────

export interface StudioContact {
  id: string;
  studioId: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface Studio {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  logoObjectKey: string | null;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  /** Admin-set rate paid per net final hour of finished audio, in USD. */
  hourlyRateUsd?: number | null;
}

export interface StudioStats {
  contacts: number;
  productionFiles: number;
  assignedFiles: number;
  samplesTotal: number;
  samplesPending: number;
  samplesApproved: number;
  samplesRefused: number;
  deliveries: number;
  deliveriesCompleted: number;
  netFinalHours: number;
  costUsd: number | null;
}

export interface StudioWithStats extends Studio {
  stats: StudioStats;
}

export interface StudiosSummary {
  totalStudios: number;
  activeStudios: number;
  totalUsers: number;
  totalProductionFiles: number;
  totalAssigned: number;
  samplesPending: number;
  samplesApproved: number;
  samplesRefused: number;
  totalDeliveries: number;
  totalNetHours: number;
  totalCostUsd: number;
}

export interface StudiosResponse {
  studios: StudioWithStats[];
  summary: StudiosSummary;
}

export interface StudioAsset {
  id: string;
  studioId: string;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

export interface StudioProductionFile {
  id: string;
  studioId: string;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  /** Catalog audiobook this production file is assigned to narrate (null = unassigned). */
  audiobookId: string | null;
  /** Title of the assigned catalog audiobook, when assigned. */
  audiobookTitle: string | null;
  /** Studio production plan (filled after a sample is approved). */
  narrator?: string | null;
  expectedNetHours?: number | null;
  estimatedFinishHours?: number | null;
  /** Whether this file has an approved narration sample (gates the plan form). */
  hasApprovedSample?: boolean;
}

export interface StudioSample {
  id: string;
  studioId: string;
  bookId: string | null;
  bookName: string | null;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "approved" | "refused";
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface StudioDriveUpload {
  id: string;
  studioId: string;
  name: string;
  status: "pending" | "uploading" | "completed" | "failed";
  driveFileId: string | null;
  error: string | null;
  createdAt: string;
  /** Intake batch this delivery was bridged into (null = not yet sent to intake). */
  batchId: string | null;
  /** Catalog title this delivery was assigned to (null = unassigned delivery). */
  audiobookId: string | null;
  /** Net hours of finished audio reported by the studio at upload. */
  netFinalHours?: number | null;
  /** Free-text notes the studio attached to the delivery. */
  notes?: string | null;
}

export interface AssignedTitle {
  audiobookId: string;
  title: string;
}

export interface StudioPortalResponse {
  studio: Studio;
  assets: StudioAsset[];
  productionFiles: StudioProductionFile[];
  samples: StudioSample[];
  driveUploads: StudioDriveUpload[];
  /** Titles an operator assigned to this studio; valid delivery targets. */
  assignedTitles: AssignedTitle[];
}

export interface AcquisitionUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface AcquisitionPortalStudio {
  studio: Studio;
  productionFiles: StudioProductionFile[];
  driveUploads: StudioDriveUpload[];
}

export interface AcquisitionPortalResponse {
  studios: AcquisitionPortalStudio[];
}
