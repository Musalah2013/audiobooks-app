import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Search, CheckCircle, XCircle, AlertCircle, ArrowLeft, FileText, Loader2, ChevronDown } from 'lucide-react';
import { useApi, apiRequest, API_BASE, downloadFile } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { BatchDetailResponse, Candidate, Seller } from '@api';

const ACTIVE_INTAKE_STATUSES = new Set(['intake_queued', 'normalizing']);
const FAILED_STATUSES = new Set(['intake_failed']);
const ACTIVE_BATCH_STATUSES = new Set(['parsing_metadata']);

function formatMegabytes(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

function CollapsibleCard({
  title,
  extra,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  extra?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2 justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 min-w-0 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
          <span className="text-lg font-semibold text-gray-900">{title}</span>
        </button>
        {extra && <div className="flex items-center gap-2 shrink-0">{extra}</div>}
      </div>
      {open && children}
    </div>
  );
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<BatchDetailResponse>(`/api/ingestions/${id}`);
  const { data: meData } = useApi<{ user: { permissions: string[] } }>('/api/auth/me');
  const isAdmin = meData?.user.permissions.includes('users') ?? false;
  const [liveData, setLiveData] = useState<BatchDetailResponse | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [sellerQuery, setSellerQuery] = useState('');
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [metadataUploadFile, setMetadataUploadFile] = useState<File | null>(null);
  const { addToast } = useToast();
  const { isArabic } = useLocale();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'source' | 'metadata' | 'matching' | 'activity'>('overview');
  const [editingMetadata, setEditingMetadata] = useState<string | null>(null);
  const [metadataForm, setMetadataForm] = useState<Record<string, string>>({});
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (data) {
      setLiveData(data);
    }
  }, [data]);

  useEffect(() => {
    if (!id) return;
    const source = new EventSource(`${API_BASE}/api/ingestions/${id}/stream`, { withCredentials: true });
    streamRef.current = source;

    source.onopen = () => {
      setStreamConnected(true);
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as BatchDetailResponse;
        setLiveData(payload);
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      source.close();
      streamRef.current = null;
      setStreamConnected(false);
    };
  }, [id]);

  const effectiveData = liveData ?? data;
  const status = effectiveData?.batch?.status;
  const batch = effectiveData?.batch;
  const candidates = effectiveData?.candidates ?? [];
  const workbookFiles = (batch?.sourceManifest ?? []).filter((item) => /\.(xlsx|xlsm|xls)$/i.test(item.name));
  const detectedGroups = batch?.normalization?.groups ?? [];
  const metadataRows = batch?.normalization?.metadataRows ?? [];
  const metadataReport = batch?.normalization?.metadataNormalizationReport;

  async function loadSellers() {
    setActionLoading('search-sellers');
    try {
      const payload = await apiRequest<{ sellers: Seller[] }>(`/api/sellers?q=${encodeURIComponent(sellerQuery)}`);
      setSellers(payload.sellers ?? []);
      if ((payload.sellers ?? []).length === 0) {
        addToast(isArabic ? 'لم يُعثر على بائعين' : 'No sellers found', 'error');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل البحث عن البائع' : 'Seller search failed'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function lockSeller(seller: Seller) {
    setActionLoading('lock-seller');
    try {
      await apiRequest(`/api/ingestions/${id}/lock-seller`, {
        method: 'POST',
        body: { sellerId: seller.id, sellerName: seller.name },
      });
      addToast(isArabic ? 'تم تأكيد البائع بنجاح' : 'Seller locked successfully', 'success');
      refetch();
      setSellers([]);
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تأكيد البائع' : 'Failed to lock seller'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function parseMetadata() {
    setActionLoading('parse-metadata');
    try {
      await apiRequest(`/api/ingestions/${id}/parse-metadata`, { method: 'POST' });
      addToast(isArabic ? 'تم تحليل البيانات الوصفية بنجاح' : 'Metadata parsed successfully', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تحليل البيانات الوصفية' : 'Failed to parse metadata'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function selectMetadataSheet(objectKey: string, name: string) {
    setActionLoading(`select-metadata-${objectKey}`);
    try {
      await apiRequest(`/api/ingestions/${id}/select-metadata-sheet`, {
        method: 'POST',
        body: { objectKey },
      });
      addToast((isArabic ? 'تم اختيار ملف البيانات: ' : 'Selected metadata sheet: ') + name, 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل اختيار ملف البيانات' : 'Failed to select metadata sheet'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function uploadMetadataSheet() {
    if (!metadataUploadFile) {
      addToast(isArabic ? 'اختر ملف بيانات أولاً' : 'Choose a metadata workbook first', 'error');
      return;
    }
    setActionLoading('upload-metadata');
    try {
      const upload = await apiRequest<{ uploadUrl: string; objectKey: string }>(`/api/ingestions/${id}/metadata-upload-url`, {
        method: 'POST',
        body: {
          fileName: metadataUploadFile.name,
          contentType: metadataUploadFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
      const uploadTarget = upload.uploadUrl.startsWith('http')
        ? upload.uploadUrl
        : `${API_BASE}${upload.uploadUrl}`;
      const putResponse = await fetch(uploadTarget, {
        method: 'PUT',
        headers: {
          'Content-Type': metadataUploadFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: metadataUploadFile,
      });
      if (!putResponse.ok) {
        throw new Error(`Metadata upload failed with HTTP ${putResponse.status}`);
      }
      await apiRequest(`/api/ingestions/${id}/finalize-metadata-upload`, {
        method: 'POST',
        body: { objectKey: upload.objectKey },
      });
      addToast((isArabic ? 'تم رفع ملف البيانات: ' : 'Uploaded metadata sheet: ') + metadataUploadFile.name, 'success');
      setMetadataUploadFile(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل رفع ملف البيانات' : 'Failed to upload metadata sheet'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function startIntake() {
    setActionLoading('start-intake');
    try {
      await apiRequest(`/api/ingestions/${id}/start-intake`, { method: 'POST' });
      addToast(isArabic ? 'تم إضافة استيراد Drive إلى قائمة الانتظار' : 'Drive intake queued', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل بدء الاستيراد' : 'Failed to start intake'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function confirmExistingSeller() {
    if (!batch?.sellerId || !batch?.sellerName) return;
    setActionLoading('lock-seller');
    try {
      await apiRequest(`/api/ingestions/${id}/lock-seller`, {
        method: 'POST',
        body: { sellerId: batch.sellerId, sellerName: batch.sellerName },
      });
      addToast((isArabic ? 'تم تأكيد البائع: ' : 'Seller confirmed: ') + batch.sellerName, 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تأكيد البائع' : 'Failed to confirm seller'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function reconcile() {
    setActionLoading('reconcile');
    try {
      await apiRequest(`/api/ingestions/${id}/reconcile`, { method: 'POST' });
      addToast(isArabic ? 'اكتملت المطابقة' : 'Reconciliation completed', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشلت المطابقة' : 'Failed to reconcile'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function approveBatch() {
    setActionLoading('approve');
    try {
      await apiRequest(`/api/ingestions/${id}/approve`, { method: 'POST' });
      addToast(isArabic ? 'تمت الموافقة على الدفعة بنجاح' : 'Batch approved successfully', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشلت الموافقة على الدفعة' : 'Failed to approve batch'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function finalizeReconciliation() {
    setActionLoading('finalize-reconciliation');
    try {
      await apiRequest(`/api/ingestions/${id}/finalize-reconciliation`, { method: 'POST' });
      addToast(isArabic ? 'تمت الموافقة على المطابقة' : 'Reconciliation approved', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل إنهاء المطابقة' : 'Failed to finalize reconciliation'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function retryIntake() {
    setActionLoading('retry-intake');
    try {
      await apiRequest(`/api/ingestions/${id}/retry-intake`, { method: 'POST' });
      addToast(isArabic ? 'جاري إعادة المحاولة…' : 'Retrying intake…', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشلت إعادة المحاولة' : 'Failed to retry'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function skipFile(objectKey: string, name: string) {
    setActionLoading(`skip-${objectKey}`);
    try {
      await apiRequest(`/api/ingestions/${id}/skip-file`, {
        method: 'POST',
        body: { objectKey },
      });
      addToast((isArabic ? 'طُلب تخطي ' : 'Skip requested for ') + name, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل طلب التخطي' : 'Failed to request skip'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function setDecision(candidateId: string, decision: string) {
    setActionLoading(`decision-${candidateId}`);
    try {
      await apiRequest(`/api/candidates/${candidateId}/decision`, {
        method: 'POST',
        body: { decision, reason: `Set from UI as ${decision}` },
      });
      addToast((isArabic ? 'تم تعيين القرار: ' : 'Decision set: ') + decision, 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تعيين القرار' : 'Failed to set decision'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function bulkSetDecision(decision: string) {
    if (selectedCandidates.size === 0) return;
    setActionLoading('bulk-decision');
    try {
      await Promise.all(
        [...selectedCandidates].map((candidateId) =>
          apiRequest(`/api/candidates/${candidateId}/decision`, {
            method: 'POST',
            body: { decision, reason: `Bulk ${decision} from UI` },
          }),
        ),
      );
      addToast(`${selectedCandidates.size} ${isArabic ? 'قرار مُعيَّن: ' : 'decisions set: '}${decision}`, 'success');
      setSelectedCandidates(new Set());
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل القرار الجماعي' : 'Bulk decision failed'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function assignGroup(candidateId: string, sourceGroupKey: string) {
    setActionLoading(`assign-${candidateId}`);
    try {
      await apiRequest(`/api/candidates/${candidateId}/source-group`, {
        method: 'POST',
        body: { sourceGroupKey },
      });
      addToast(isArabic ? 'تم ربط مجموعة المصدر بنجاح' : 'Source group linked successfully', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل ربط مجموعة المصدر' : 'Failed to link source group'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  const [revertConfirm, setRevertConfirm] = useState(false);
  const [editingMapping, setEditingMapping] = useState(false);
  const [mappingForm, setMappingForm] = useState<Record<string, number | null>>({});

  async function revertBatch() {
    setActionLoading('revert-batch');
    try {
      const result = await apiRequest<{ revertedFrom: string; revertedTo: string }>(`/api/ingestions/${id}/revert`, { method: 'POST' });
      addToast(
        isArabic
          ? `تم الرجوع من "${result.revertedFrom}" إلى "${result.revertedTo}"`
          : `Reverted from "${result.revertedFrom}" to "${result.revertedTo}"`,
        'success',
      );
      setRevertConfirm(false);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل الرجوع' : 'Revert failed'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  function openMetadataEdit(candidate: Candidate) {
    const ov = candidate.metadataOverride ?? {};
    setMetadataForm({
      title: String(ov.title ?? candidate.title ?? ''),
      author: String(ov.author ?? candidate.author ?? ''),
      subtitle: String(ov.subtitle ?? candidate.subtitle ?? ''),
      narrator: String(ov.narrator ?? candidate.narrator ?? ''),
      isbn: String(ov.isbn ?? candidate.isbn ?? ''),
      pubYear: String(ov.pubYear ?? ''),
      genre: String(ov.genre ?? ''),
      sellingType: String(ov.sellingType ?? ''),
      price: String(ov.price ?? ''),
      trackCount: String(ov.trackCount ?? ''),
      importancePoints: String(ov.importancePoints ?? ''),
    });
    setEditingMetadata(candidate.id);
  }

  async function saveMetadata(candidateId: string) {
    setActionLoading(`metadata-save-${candidateId}`);
    try {
      const payload: Record<string, unknown> = {};
      const numFields = new Set(['price', 'trackCount', 'importancePoints']);
      for (const [k, v] of Object.entries(metadataForm)) {
        if (v.trim() === '') {
          payload[k] = null;
        } else if (numFields.has(k)) {
          payload[k] = Number(v);
        } else {
          payload[k] = v.trim();
        }
      }
      await apiRequest(`/api/candidates/${candidateId}/metadata`, { method: 'PATCH', body: payload });
      addToast(isArabic ? 'تم حفظ البيانات الوصفية' : 'Metadata saved', 'success');
      setEditingMetadata(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل حفظ البيانات' : 'Failed to save metadata'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDownload(objectKey: string) {
    setDownloadLoading(objectKey);
    try {
      await downloadFile(objectKey);
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تنزيل الملف' : 'Failed to download file'), 'error');
    } finally {
      setDownloadLoading(null);
    }
  }

  async function remapMetadata() {
    setActionLoading('remap-metadata');
    try {
      await apiRequest(`/api/ingestions/${id}/remap-metadata`, {
        method: 'POST',
        body: { mapping: mappingForm },
      });
      addToast(isArabic ? 'تم تحديث تعيين الأعمدة' : 'Column mapping updated', 'success');
      setEditingMapping(false);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تحديث التعيين' : 'Failed to update mapping'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <span>{isArabic ? `فشل تحميل الدفعة: ${error}` : `Failed to load batch: ${error}`}</span>
        </div>
      </div>
    );
  }

  const isReadyToStartIntake = batch?.sourceType === 'drive' && (status === 'ingested' || status === 'metadata_sheet_selected');
  const isNormalizing = status ? ACTIVE_INTAKE_STATUSES.has(status) : false;
  const isFailed = status && FAILED_STATUSES.has(status);
  const isBatchBusy = status ? ACTIVE_BATCH_STATUSES.has(status) : false;
  const intakeError = batch?.normalization?.intakeError;
  const metadataParseError = batch?.normalization?.metadataParseError;
  const intakeProgress = batch?.normalization?.intakeProgress;
  const intakeLogs = batch?.normalization?.intakeLogs ?? [];
  const events = effectiveData?.events ?? [];
  const activeTransfers = intakeProgress?.activeTransfers ?? [];
  const matchedGroupKeys = new Set(candidates.map((candidate) => candidate.sourceGroupKey).filter(Boolean));
  const unmatchedGroups = detectedGroups.filter((group) => !matchedGroupKeys.has(group.groupKey));
  const unmatchedMetadataRows = metadataRows.filter(
    (row) => !candidates.some((candidate) => candidate.metadataRowIndex === row.rowIndex),
  );
  const allCandidatesResolved = candidates.length > 0 && candidates.every(
    // A candidate is considered resolved if it has a decision, OR if it has no source group
    // (orphan metadata rows with no audio match cannot be decided on and should not block finalization)
    (candidate) => (candidate.classificationDecision && candidate.classificationDecision.length > 0) || !candidate.sourceGroupKey,
  );
  const canSelectMetadataSheet = status === 'normalized' || status === 'metadata_sheet_pending' || status === 'metadata_sheet_selected';
  const canUploadSupplementarySheet = ['metadata_parsed', 'seller_locked', 'reconciliation_in_review'].includes(status ?? '');
  const canParseMetadata = status === 'metadata_sheet_selected' || canUploadSupplementarySheet;
  const canSearchSellers = status === 'metadata_parsed' && !batch?.sellerId;
  const canConfirmExistingSeller = status === 'metadata_parsed' && !!batch?.sellerId;
  const canReconcile = status === 'seller_locked';
  const canFinalizeReconciliation = status === 'reconciliation_in_review' && allCandidatesResolved;
  const canApproveBatch = status === 'reconciliation_approved';
  const canEditCandidateDecisions = status === 'reconciliation_in_review';
  const activeTransferBytes = activeTransfers.reduce((sum, transfer) => sum + transfer.downloadedBytes, 0);
  const totalCopiedBytesLive = (intakeProgress?.copiedSourceBytes ?? 0) + activeTransferBytes;
  const totalByteProgress = intakeProgress?.totalSourceBytes
    ? Math.min(100, Math.round((totalCopiedBytesLive / intakeProgress.totalSourceBytes) * 100))
    : 0;
  const archiveProgress = intakeProgress?.totalArchives
    ? Math.min(100, Math.round(((intakeProgress.extractedArchives ?? 0) / intakeProgress.totalArchives) * 100))
    : 0;

  const currentActionHint =
    isReadyToStartIntake
      ? (isArabic ? 'ابدأ الاستيراد أولاً. كل الخطوات اللاحقة محجوبة حتى ينتهي استيراد المصدر.' : 'Start intake first. Everything downstream is blocked until source import finishes.')
      : canSelectMetadataSheet && !batch?.metadataSheetObjectKey
        ? (isArabic ? 'اختر أو ارفع ملف بيانات قبل التحليل.' : 'Select or upload a metadata workbook before parsing.')
        : canParseMetadata
          ? (isArabic ? 'حلّل البيانات الوصفية التالية. قفل البائع والمطابقة محجوبان حتى ينتهي التحليل.' : 'Parse metadata next. Seller lock and matching stay blocked until parsing completes.')
          : canSearchSellers
            ? (isArabic ? 'أقفل البائع التالي حتى تتمكن من بدء المطابقة.' : 'Lock the seller next so reconciliation can start.')
            : canReconcile
              ? (isArabic ? 'شغّل المطابقة لتوليد مرشحين مدركين للمجموعات.' : 'Run reconciliation to generate group-aware candidates.')
              : status === 'reconciliation_in_review' && unmatchedGroups.length > 0
                ? (isArabic ? 'أحلّ أو صنّف كل مجموعة مصدر غير مطابقة قبل الموافقة النهائية.' : 'Resolve or classify every unmatched source group before final approval.')
                : canFinalizeReconciliation
                  ? (isArabic ? 'أحلّ كل مرشح ومجموعة غير مطابقة، ثم أنهِ المطابقة.' : 'Resolve every candidate and unmatched group, then finalize reconciliation.')
                  : canApproveBatch
                    ? (isArabic ? 'وافق على الدفعة لإنشاء سجلات الكتب المرجعية.' : 'Approve the batch to create canonical book records.')
                    : (isArabic ? 'هذه الدفعة محجوبة بمرحلة سابقة أو مكتملة بالفعل.' : 'This batch is blocked by an earlier stage or already completed.');

  const stepStates = [
    {
      key: 'import',
      label: batch?.sourceType === 'drive'
        ? (isArabic ? 'استيراد الملفات' : 'Import Files')
        : (isArabic ? 'رفع + تطبيع' : 'Upload + Normalize'),
      state:
        status === 'ingested' || status === 'metadata_sheet_selected'
          ? 'ready'
          : status === 'intake_queued' || status === 'normalizing'
            ? 'active'
            : batch?.sourceManifest?.length
              ? 'done'
              : 'blocked',
    },
    {
      key: 'metadata',
      label: isArabic ? 'تحليل البيانات' : 'Parse Metadata',
      state:
        status === 'parsing_metadata'
          ? 'active'
          : ['metadata_parsed', 'seller_locked', 'reconciliation_in_review', 'reconciliation_approved', 'records_created'].includes(status ?? '')
            ? 'done'
            : status === 'metadata_sheet_selected'
              ? 'ready'
              : 'blocked',
    },
    {
      key: 'seller',
      label: isArabic ? 'قفل البائع' : 'Lock Seller',
      state:
        ['seller_locked', 'reconciliation_in_review', 'reconciliation_approved', 'records_created'].includes(status ?? '')
          ? 'done'
          : status === 'metadata_parsed'
            ? 'ready'
            : 'blocked',
    },
    {
      key: 'reconcile',
      label: isArabic ? 'مطابقة + تصنيف' : 'Reconcile + Classify',
      state:
        ['reconciliation_approved', 'records_created'].includes(status ?? '')
          ? 'done'
          : status === 'reconciliation_in_review'
            ? 'active'
            : status === 'seller_locked'
              ? 'ready'
              : 'blocked',
    },
    {
      key: 'records',
      label: isArabic ? 'إنشاء سجلات الكتب' : 'Create Book Records',
      state: status === 'records_created' ? 'done' : status === 'reconciliation_approved' ? 'ready' : 'blocked',
    },
  ];

  const stateLabel: Record<string, string> = {
    done: isArabic ? 'مكتمل' : 'done',
    active: isArabic ? 'نشط' : 'active',
    ready: isArabic ? 'جاهز' : 'ready',
    blocked: isArabic ? 'محجوب' : 'blocked',
  };

  const tabs: Array<[string, string]> = [
    ['overview', isArabic ? 'نظرة عامة' : 'Overview'],
    ['source', isArabic ? 'المصدر' : 'Source'],
    ['metadata', isArabic ? 'البيانات' : 'Metadata'],
    ['matching', isArabic ? 'المطابقة' : 'Matching'],
    ['activity', isArabic ? 'النشاط' : 'Activity'],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/batches" className="text-gray-500 hover:text-gray-700 shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{isArabic ? 'دفعة ' : 'Batch '}{batch?.id?.slice(0, 8)}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status === 'records_created' ? 'bg-emerald-100 text-emerald-700' :
              status?.includes('failed') ? 'bg-red-100 text-red-700' :
              status?.includes('queued') || status?.includes('ing') ? 'bg-blue-100 text-blue-700' :
              'bg-amber-100 text-amber-700'
            }`}>{status}</span>
            {batch?.intakeMode && <span className="text-xs text-gray-400">{batch.intakeMode}</span>}
          </div>
        </div>
      </div>

      {/* Intake ready banner */}
      {isReadyToStartIntake && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">{isArabic ? 'تم إنشاء دفعة Drive' : 'Drive batch created'}</p>
            <p className="text-sm text-amber-700">
              {isArabic
                ? 'ابدأ الاستيراد أولاً. يبقى تحليل البيانات وقفل البائع والمطابقة محجوبة حتى ينتهي استيراد Drive.'
                : 'Start intake first. Metadata parsing, seller locking, and reconciliation stay blocked until Drive import finishes.'}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={startIntake}
            disabled={actionLoading === 'start-intake'}
          >
            {actionLoading === 'start-intake' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isArabic ? 'بدء الاستيراد' : 'Start Intake'}
          </button>
        </div>
      )}

      <CollapsibleCard title={isArabic ? 'تقدم المراحل' : 'Flow Progress'}>
        <ol className="flex flex-col sm:flex-row gap-0">
          {stepStates.map((step, i) => {
            const isLast = i === stepStates.length - 1;
            const colors = step.state === 'done'
              ? { ring: 'bg-emerald-500', text: 'text-emerald-700', sub: 'text-emerald-600', connector: 'bg-emerald-300' }
              : step.state === 'active'
                ? { ring: 'bg-blue-500', text: 'text-blue-700', sub: 'text-blue-600', connector: 'bg-gray-200' }
                : step.state === 'ready'
                  ? { ring: 'bg-amber-400', text: 'text-amber-700', sub: 'text-amber-600', connector: 'bg-gray-200' }
                  : { ring: 'bg-gray-300', text: 'text-gray-500', sub: 'text-gray-400', connector: 'bg-gray-200' };
            return (
              <li key={step.key} className="flex sm:flex-col flex-1 min-w-0">
                <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-0 flex-1">
                  {/* Dot + connector row */}
                  <div className="flex sm:flex-row flex-col items-center sm:w-full">
                    <span className={`shrink-0 w-3 h-3 rounded-full ${colors.ring} ${step.state === 'active' ? 'ring-4 ring-blue-100' : step.state === 'ready' ? 'ring-4 ring-amber-100' : ''}`} />
                    {!isLast && (
                      <div className={`sm:flex-1 sm:h-0.5 sm:w-full h-6 w-0.5 sm:mx-1 mx-0 my-0 sm:my-0 ${colors.connector} shrink-0`} />
                    )}
                  </div>
                  {/* Label area */}
                  <div className="pb-4 sm:pb-0 sm:pt-2 sm:pr-2 min-w-0">
                    <p className={`text-sm font-medium leading-tight ${colors.text}`}>{step.label}</p>
                    <p className={`text-xs mt-0.5 uppercase tracking-wide ${colors.sub}`}>{stateLabel[step.state] ?? step.state}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex items-center justify-between border-t border-gray-100 pt-3 gap-3 flex-wrap">
          <p className="text-sm text-gray-600">{currentActionHint}</p>
          {isAdmin && ['records_created','reconciliation_approved','reconciliation_in_review','seller_locked','metadata_parsed','parsing_metadata','metadata_sheet_selected','normalized','intake_failed'].includes(status ?? '') && (
            revertConfirm ? (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm">
                <span className="text-red-800 font-medium">{isArabic ? 'تأكيد الرجوع؟' : 'Confirm revert?'}</span>
                <button
                  type="button"
                  onClick={revertBatch}
                  disabled={actionLoading === 'revert-batch'}
                  className="rounded-full bg-red-600 px-3 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading === 'revert-batch' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (isArabic ? 'نعم، تراجع' : 'Yes, revert')}
                </button>
                <button
                  type="button"
                  onClick={() => setRevertConfirm(false)}
                  className="text-xs text-red-700 hover:text-red-900"
                >
                  {isArabic ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRevertConfirm(true)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-red-300 hover:text-red-700"
              >
                {isArabic ? 'رجوع للخطوة السابقة' : 'Revert to previous step'}
              </button>
            )
          )}
        </div>
      </CollapsibleCard>

      <div className="card">
        <div className="flex flex-wrap gap-2">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={activeTab === key ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
              onClick={() => setActiveTab(key as typeof activeTab)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!isNormalizing && (
        (activeTab === 'source' || activeTab === 'metadata') && (
        <div className="grid gap-6 xl:grid-cols-2">
          <CollapsibleCard title={isArabic ? 'لقطة المصدر' : 'Source Snapshot'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{isArabic ? 'الملفات المستوردة' : 'Imported files'}</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{batch?.sourceManifest?.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{isArabic ? 'المجموعات المكتشفة' : 'Detected groups'}</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{detectedGroups.length}</p>
              </div>
            </div>
            {detectedGroups.length > 0 && (
              <div className="space-y-3">
                {detectedGroups.slice(0, 8).map((group) => (
                  <div key={group.groupKey} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">{group.displayName}</p>
                        <p className="text-xs text-gray-500">
                          {group.items.length} {isArabic ? 'ملفات · العنوان المستنتج: ' : 'files · inferred title: '}{group.inferredTitle}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs ${matchedGroupKeys.has(group.groupKey) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {matchedGroupKeys.has(group.groupKey) ? (isArabic ? 'مطابق' : 'matched') : (isArabic ? 'غير مطابق' : 'unmatched')}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">{group.reasons.join(' · ')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.items.slice(0, 6).map((item) => (
                        <span key={item.key} className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                          {item.name}
                        </span>
                      ))}
                      {group.items.length > 6 && (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                          +{group.items.length - 6} {isArabic ? 'أكثر' : 'more'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleCard>

          <CollapsibleCard title={isArabic ? 'لقطة البيانات الوصفية' : 'Metadata Snapshot'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{isArabic ? 'صفوف البيانات' : 'Metadata rows'}</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{metadataRows.length}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{isArabic ? 'صف الرأس المكتشف' : 'Detected header row'}</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{metadataReport?.headerRowNumber ?? '—'}</p>
              </div>
            </div>
            {metadataReport?.columns && (
              <div className="rounded-lg border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-700">
                    {isArabic ? 'تعيين الأعمدة' : 'Column mapping'} · {metadataReport.mode ?? 'heuristic'}
                  </p>
                  {!editingMapping ? (
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:text-blue-800 shrink-0"
                      onClick={() => {
                        const form: Record<string, number | null> = {};
                        for (const [field, col] of Object.entries(metadataReport.columns ?? {})) {
                          form[field] = col.index;
                        }
                        setMappingForm(form);
                        setEditingMapping(true);
                      }}
                    >
                      {isArabic ? 'تعديل التعيين' : 'Edit mapping'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="rounded-full bg-blue-600 px-3 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        onClick={remapMetadata}
                        disabled={actionLoading === 'remap-metadata'}
                      >
                        {actionLoading === 'remap-metadata' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (isArabic ? 'حفظ' : 'Save')}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-gray-700"
                        onClick={() => setEditingMapping(false)}
                      >
                        {isArabic ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </div>
                {!editingMapping ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(metadataReport.columns).map(([field, col]) => (
                      <span key={field} className={`rounded-full px-2 py-0.5 text-xs font-medium ${col.index != null ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                        {field}{col.index != null ? ` ← ${col.header ?? `col ${col.index}`}` : ' ✗'}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.keys(metadataReport.columns).map((field) => (
                      <div key={field}>
                        <label className="block text-xs text-gray-500 mb-0.5">{field}</label>
                        <select
                          className="input w-full text-xs"
                          value={mappingForm[field] ?? ''}
                          onChange={(e) =>
                            setMappingForm((prev) => ({
                              ...prev,
                              [field]: e.target.value === '' ? null : Number(e.target.value),
                            }))
                          }
                        >
                          <option value="">{isArabic ? '— بلا تعيين —' : '— none —'}</option>
                          {(metadataReport.headerCells ?? []).map((cell) => (
                            <option key={cell.col} value={cell.index}>
                              {cell.header} ({cell.col})
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {metadataReport?.warnings?.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">{isArabic ? 'تحذيرات التطبيع' : 'Normalization warnings'}</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {metadataReport.warnings.slice(0, 6).map((warning, index) => (
                    <li key={`${warning}-${index}`}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {metadataRows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-start">{isArabic ? 'صف' : 'Row'}</th>
                      <th className="px-3 py-2 text-start">{isArabic ? 'العنوان' : 'Title'}</th>
                      <th className="px-3 py-2 text-start">{isArabic ? 'الناشر' : 'Publisher'}</th>
                      <th className="px-3 py-2 text-start">ISBN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metadataRows.slice(0, 8).map((row) => (
                      <tr key={row.rowIndex} className="border-t border-gray-100">
                        <td className="px-3 py-2">{row.rowIndex}</td>
                        <td className="px-3 py-2">{row.title || '—'}</td>
                        <td className="px-3 py-2">{row.publisher || '—'}</td>
                        <td className="px-3 py-2">{row.isbn || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleCard>
        </div>
        )
      )}

      {/* Drive intake step-by-step progress */}
      {(activeTab === 'overview' || activeTab === 'source') && isNormalizing && (
        <div className="card space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-sky-600 animate-spin shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-[color:var(--samawy-ink)]">
                {status === 'intake_queued'
                  ? (isArabic ? 'استيراد Drive في قائمة الانتظار…' : 'Drive intake queued…')
                  : (isArabic ? 'جاري الاستيراد من Google Drive' : 'Importing from Google Drive')}
              </p>
              <p className="text-xs text-[color:var(--fg-2)]">
                {isArabic ? 'هذه الصفحة تتحدث تلقائياً' : 'This page updates automatically'}
                {streamConnected
                  ? <span className="ms-2 text-green-600">● {isArabic ? 'متصل' : 'live'}</span>
                  : <span className="ms-2 text-amber-500">● {isArabic ? 'إعادة اتصال' : 'reconnecting'}</span>}
              </p>
            </div>
            {/* Recovery for a stuck intake: re-enqueues and resumes from where it left off. */}
            <button
              type="button"
              className="btn-secondary text-xs shrink-0"
              onClick={retryIntake}
              disabled={actionLoading === 'retry-intake'}
              title={isArabic ? 'إعادة تشغيل الاستيراد إذا توقف' : 'Restart intake if it appears stuck'}
            >
              {actionLoading === 'retry-intake' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {isArabic ? 'إعادة تشغيل الاستيراد' : 'Restart intake'}
            </button>
          </div>

          {/* Step timeline */}
          {intakeProgress && (() => {
            const phase = intakeProgress.phase ?? '';
            const phaseOrder = ['authorizing_drive', 'listing_drive', 'copying_source_files', 'extracting_archives'];
            const phaseIdx = phaseOrder.indexOf(phase);

            function stepState(stepPhase: string): 'done' | 'active' | 'pending' {
              const idx = phaseOrder.indexOf(stepPhase);
              if (phaseIdx > idx) return 'done';
              if (phaseIdx === idx) return 'active';
              return 'pending';
            }

            const hasArchives = (intakeProgress.totalArchives ?? 0) > 0;

            return (
              <ol className="space-y-3">
                {/* Step 1 — Authorize */}
                {(() => {
                  const s = stepState('authorizing_drive');
                  return (
                    <li className="flex items-start gap-3">
                      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${s === 'done' ? 'bg-green-100 text-green-700' : s === 'active' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'}`}>
                        {s === 'done' ? '✓' : s === 'active' ? <Loader2 className="w-3 h-3 animate-spin" /> : '1'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${s === 'pending' ? 'text-[color:var(--fg-2)]' : 'text-[color:var(--samawy-ink)]'}`}>
                          {isArabic ? 'التفويض' : 'Authorize'}
                        </p>
                        {s === 'active' && <p className="text-xs text-sky-600">{isArabic ? 'جاري التحقق من صلاحيات Google Drive…' : 'Verifying Google Drive credentials…'}</p>}
                        {s === 'done' && <p className="text-xs text-green-600">{isArabic ? 'تم التحقق من الصلاحيات' : 'Credentials verified'}</p>}
                      </div>
                    </li>
                  );
                })()}

                {/* Step 2 — List files */}
                {(() => {
                  const s = stepState('listing_drive');
                  const filesFound = intakeProgress.listingFilesFound;
                  const foldersVisited = intakeProgress.listingFoldersVisited;
                  const currentFolder = intakeProgress.listingCurrentFolder;
                  const discovered = intakeProgress.totalSourceFiles;
                  return (
                    <li className="flex items-start gap-3">
                      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${s === 'done' ? 'bg-green-100 text-green-700' : s === 'active' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'}`}>
                        {s === 'done' ? '✓' : s === 'active' ? <Loader2 className="w-3 h-3 animate-spin" /> : '2'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${s === 'pending' ? 'text-[color:var(--fg-2)]' : 'text-[color:var(--samawy-ink)]'}`}>
                          {isArabic ? 'فحص الملفات' : 'Inspect files'}
                        </p>
                        {s === 'active' && (
                          <div className="mt-1 space-y-0.5 text-xs text-sky-700">
                            {typeof filesFound === 'number' && (
                              <p>{isArabic ? `تم اكتشاف ${filesFound} ملف في ${foldersVisited ?? 0} مجلد` : `Found ${filesFound} file${filesFound !== 1 ? 's' : ''} across ${foldersVisited ?? 0} folder${(foldersVisited ?? 0) !== 1 ? 's' : ''}`}</p>
                            )}
                            {!filesFound && <p>{isArabic ? 'جاري مسح المجلدات…' : 'Scanning folders…'}</p>}
                            {currentFolder && <p className="text-sky-500 truncate">{isArabic ? `المجلد: ${currentFolder}` : `Folder: ${currentFolder}`}</p>}
                          </div>
                        )}
                        {s === 'done' && typeof discovered === 'number' && (
                          <p className="text-xs text-green-600">
                            {isArabic
                              ? `${discovered} ملف مكتشف · ${formatMegabytes(intakeProgress.totalSourceBytes)}`
                              : `${discovered} file${discovered !== 1 ? 's' : ''} discovered · ${formatMegabytes(intakeProgress.totalSourceBytes)}`}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })()}

                {/* Step 3 — Copy files */}
                {(() => {
                  const s = stepState('copying_source_files');
                  const copied = intakeProgress.copiedSourceFiles ?? 0;
                  const total = intakeProgress.totalSourceFiles ?? 0;
                  return (
                    <li className="flex items-start gap-3">
                      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${s === 'done' ? 'bg-green-100 text-green-700' : s === 'active' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'}`}>
                        {s === 'done' ? '✓' : s === 'active' ? <Loader2 className="w-3 h-3 animate-spin" /> : '3'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${s === 'pending' ? 'text-[color:var(--fg-2)]' : 'text-[color:var(--samawy-ink)]'}`}>
                          {isArabic ? 'نسخ الملفات' : 'Copy files'}
                        </p>
                        {s === 'active' && total > 0 && (
                          <div className="mt-2 space-y-2">
                            {/* Overall copy bar */}
                            <div>
                              <div className="flex items-center justify-between text-xs text-sky-700 mb-1">
                                <span>{copied} / {total} {isArabic ? 'ملف' : 'files'}</span>
                                <span>{formatMegabytes(totalCopiedBytesLive)} / {formatMegabytes(intakeProgress.totalSourceBytes)}</span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full bg-sky-500 transition-transform duration-300 origin-left" style={{ transform: `scaleX(${totalByteProgress / 100})` }} />
                              </div>
                            </div>
                            {/* Per-file active transfers */}
                            {activeTransfers.length > 0 && (
                              <div className="space-y-2 pt-1">
                                {activeTransfers.map((transfer) => (
                                  <div key={transfer.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-3 mb-1.5">
                                      <p className="text-xs font-medium text-[color:var(--samawy-ink)] truncate min-w-0">{transfer.name}</p>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-[color:var(--fg-2)]">{formatMegabytes(transfer.downloadedBytes)} / {formatMegabytes(transfer.sizeBytes)}</span>
                                        <span className="text-xs font-semibold text-sky-700 w-9 text-right">{transfer.progressPercent}%</span>
                                        <button
                                          type="button"
                                          className="btn-secondary text-xs py-0.5 px-2"
                                          onClick={() => skipFile(transfer.key, transfer.name)}
                                          disabled={actionLoading === `skip-${transfer.key}`}
                                        >
                                          {actionLoading === `skip-${transfer.key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : (isArabic ? 'تخطي' : 'Skip')}
                                        </button>
                                      </div>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                      <div className="h-full bg-emerald-500 transition-transform duration-150 origin-left" style={{ transform: `scaleX(${transfer.progressPercent / 100})` }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {s === 'done' && (
                          <p className="text-xs text-green-600">
                            {isArabic ? `تم نسخ ${intakeProgress.totalSourceFiles ?? 0} ملف` : `${intakeProgress.totalSourceFiles ?? 0} files copied`}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })()}

                {/* Step 4 — Extract archives (only if archives present or active) */}
                {(hasArchives || stepState('extracting_archives') !== 'pending') && (() => {
                  const s = stepState('extracting_archives');
                  const extracted = intakeProgress.extractedArchives ?? 0;
                  const total = intakeProgress.totalArchives ?? 0;
                  const entries = intakeProgress.extractedEntries ?? 0;
                  return (
                    <li className="flex items-start gap-3">
                      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${s === 'done' ? 'bg-green-100 text-green-700' : s === 'active' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'}`}>
                        {s === 'done' ? '✓' : s === 'active' ? <Loader2 className="w-3 h-3 animate-spin" /> : '4'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${s === 'pending' ? 'text-[color:var(--fg-2)]' : 'text-[color:var(--samawy-ink)]'}`}>
                          {isArabic ? 'استخراج الأرشيفات' : 'Extract archives'}
                        </p>
                        {s === 'active' && (
                          <div className="mt-1.5 space-y-1">
                            <div className="flex items-center justify-between text-xs text-sky-700 mb-1">
                              <span>{extracted} / {total} {isArabic ? 'أرشيف' : 'archives'}</span>
                              {entries > 0 && <span>{entries} {isArabic ? 'ملف مستخرج' : 'entries extracted'}</span>}
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full bg-cyan-500 transition-transform duration-300 origin-left" style={{ transform: `scaleX(${archiveProgress / 100})` }} />
                            </div>
                            {intakeProgress.currentItem && (
                              <p className="text-xs text-sky-500 truncate">{isArabic ? `جاري: ${intakeProgress.currentItem}` : `Current: ${intakeProgress.currentItem}`}</p>
                            )}
                          </div>
                        )}
                        {s === 'done' && (
                          <p className="text-xs text-green-600">
                            {isArabic ? `${total} أرشيف · ${entries} ملف` : `${total} archive${total !== 1 ? 's' : ''} · ${entries} entries`}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })()}
              </ol>
            );
          })()}</div>
      )}

      {(activeTab === 'overview' || activeTab === 'source' || activeTab === 'activity') && (isNormalizing || intakeLogs.length > 0) && (
        <CollapsibleCard
          title={isArabic ? 'سجلات الاستيراد' : 'Intake Logs'}
          extra={<span className="text-sm text-gray-500">{intakeLogs.length} {isArabic ? 'إدخالات' : 'entries'}</span>}
        >
          <div className="rounded-lg border border-gray-200 bg-gray-950 text-gray-100 max-h-96 overflow-auto">
            <div className="p-3 space-y-2 font-mono text-xs">
              {intakeLogs.length === 0 && (
                <div className="text-gray-400">{isArabic ? 'في انتظار سجلات الاستيراد…' : 'Waiting for intake logs…'}</div>
              )}
              {intakeLogs.map((log, index) => (
                <div key={`${log.at}-${index}`} className="flex gap-3">
                  <span className="text-gray-500 shrink-0">{new Date(log.at).toLocaleTimeString()}</span>
                  <span
                    className={
                      log.level === 'error'
                        ? 'text-red-300'
                        : log.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                    }
                  >
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="break-all text-gray-100">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleCard>
      )}

      {/* Intake failed banner */}
      {(activeTab === 'overview' || activeTab === 'source') && isFailed && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-900">{isArabic ? 'فشل الاستيراد' : 'Intake failed'}</p>
            {intakeError && <p className="text-sm text-red-700 mt-1 font-mono break-all">{intakeError}</p>}
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={retryIntake}
            disabled={actionLoading === 'retry-intake'}
          >
            {actionLoading === 'retry-intake' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isArabic ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'metadata') && isBatchBusy && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900">{isArabic ? 'جاري تحليل البيانات الوصفية…' : 'Metadata parsing in progress…'}</p>
            <p className="text-sm text-blue-700">
              {isArabic
                ? 'يتم تطبيع ملف العمل إلى قالب الكتاب الصوتي الهيكلي. ستتحدث هذه الصفحة تلقائياً.'
                : 'The workbook is being normalized into the structured audiobook template. This page will refresh automatically.'}
            </p>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'metadata') && metadataParseError && !isBatchBusy && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-medium text-red-900">{isArabic ? 'فشل تحليل البيانات الوصفية' : 'Metadata parsing failed'}</p>
          <p className="mt-1 text-sm font-mono break-all text-red-700">{metadataParseError}</p>
        </div>
      )}

      {/* Metadata sheet selection */}
      {(activeTab === 'overview' || activeTab === 'metadata') && !isNormalizing && !isFailed && (canSelectMetadataSheet || canUploadSupplementarySheet) && (
        <CollapsibleCard title={isArabic ? 'ملف البيانات' : 'Metadata Sheet'}>
          <div>
            <p className="text-sm text-gray-500">
              {canUploadSupplementarySheet
                ? (isArabic
                    ? 'ارفع ملف بيانات إضافياً للكتب التي تنقصها بيانات. سيُعاد التحليل ويُحدَّث الكتب المفقودة فقط.'
                    : 'Upload a supplementary workbook for books missing metadata. Re-parsing will update only the missing books.')
                : (isArabic
                    ? 'اختر ملف العمل المستورد من Drive أو ارفع ملفاً مختلفاً. يبقى تحليل البيانات محجوباً حتى يتم ربط ملف عمل واحد صراحةً.'
                    : 'Select the workbook imported from Drive, or upload a different one. Metadata parsing stays blocked until one workbook is explicitly attached.')}
            </p>
          </div>

          {batch?.metadataSheetObjectKey && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {isArabic ? 'الملف المحدد: ' : 'Selected sheet: '}
              <span className="font-medium ml-2 break-all">
                {workbookFiles.find((item) => item.key === batch.metadataSheetObjectKey)?.name ?? batch.metadataSheetObjectKey.split('/').pop() ?? batch.metadataSheetObjectKey}
              </span>
            </div>
          )}

          {canSelectMetadataSheet && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900">
                {isArabic ? 'ملفات العمل المكتشفة من Drive' : 'Detected workbook files from Drive'}
              </h3>
              {workbookFiles.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {isArabic ? 'لم يُكتشف أي ملف عمل في ملفات Drive المستوردة.' : 'No workbook file was detected in the imported Drive files.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {workbookFiles.map((file) => {
                    const isSelected = batch?.metadataSheetObjectKey === file.key;
                    return (
                      <div key={file.key} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 break-all">{file.name}</p>
                          <p className="text-xs text-gray-500">
                            {file.parentPath || (isArabic ? 'الجذر' : 'root')} · {formatMegabytes(file.sizeBytes)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={isSelected ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                          onClick={() => selectMetadataSheet(file.key, file.name)}
                          disabled={actionLoading === `select-metadata-${file.key}`}
                        >
                          {actionLoading === `select-metadata-${file.key}` ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {isSelected ? (isArabic ? 'محدد' : 'Selected') : (isArabic ? 'استخدام هذا الملف' : 'Use This File')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className={`space-y-3 ${canSelectMetadataSheet ? 'border-t border-gray-200 pt-4' : ''}`}>
            <h3 className="text-sm font-medium text-gray-900">{isArabic ? 'رفع ملف بيانات آخر' : 'Upload another metadata workbook'}</h3>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".xlsx,.xlsm,.xls"
                onChange={(event) => setMetadataUploadFile(event.target.files?.[0] ?? null)}
                className="text-sm text-gray-700"
              />
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={uploadMetadataSheet}
                disabled={actionLoading === 'upload-metadata' || !metadataUploadFile}
              >
                {actionLoading === 'upload-metadata' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isArabic ? 'رفع ملف العمل' : 'Upload Workbook'}
              </button>
            </div>
            {metadataUploadFile && (
              <p className="text-xs text-gray-500">
                {isArabic ? 'جاهز للرفع: ' : 'Ready to upload: '}{metadataUploadFile.name}
              </p>
            )}
          </div>
        </CollapsibleCard>
      )}

      {/* Actions */}
      {(activeTab === 'overview' || activeTab === 'metadata' || activeTab === 'matching') && !isNormalizing && !isFailed && (
        <CollapsibleCard title={isArabic ? 'إجراءات الدفعة' : 'Batch Actions'}>
          <p className="text-sm text-gray-500">
            {isArabic
              ? 'يجب التصرف على المرحلة الصالحة التالية فقط. تبقى الإجراءات اللاحقة محجوبة حتى تكتمل المراحل السابقة.'
              : 'Only the next valid stage should be acted on. Later actions stay blocked until earlier stages complete.'}
          </p>
          <div className="flex flex-wrap gap-3">
            {canConfirmExistingSeller && (
              <button
                type="button"
                className="btn-primary"
                onClick={confirmExistingSeller}
                disabled={actionLoading === 'lock-seller'}
              >
                {actionLoading === 'lock-seller' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isArabic
                  ? `تأكيد البائع: ${batch?.sellerName}`
                  : `Confirm seller: ${batch?.sellerName}`}
              </button>
            )}
            {canSearchSellers && (
              <div className="flex gap-2 items-center">
                <input
                  className="input w-48"
                  value={sellerQuery}
                  onChange={(e) => setSellerQuery(e.target.value)}
                  placeholder={isArabic ? 'بحث عن بائع' : 'Search sellers'}
                  onKeyDown={(e) => e.key === 'Enter' && loadSellers()}
                />
                <button type="button" className="btn-secondary" onClick={loadSellers} disabled={actionLoading === 'search-sellers'}>
                  {actionLoading === 'search-sellers' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {isArabic ? 'بحث' : 'Search'}
                </button>
              </div>
            )}
            {sellers.length > 0 && (
              <div className="flex gap-2">
                {sellers.map((seller) => (
                  <button
                    type="button"
                    key={seller.id}
                    className="btn-secondary"
                    onClick={() => lockSeller(seller)}
                    disabled={actionLoading === 'lock-seller'}
                  >
                    {seller.name} #{seller.id}
                  </button>
                ))}
              </div>
            )}
            {isReadyToStartIntake && (
              <button
                type="button"
                className="btn-primary"
                onClick={startIntake}
                disabled={actionLoading === 'start-intake'}
              >
                {actionLoading === 'start-intake' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isArabic ? 'بدء الاستيراد' : 'Start Intake'}
              </button>
            )}
            {canParseMetadata && (
              <button
                type="button"
                className="btn-secondary"
                onClick={parseMetadata}
                disabled={actionLoading === 'parse-metadata' || isBatchBusy}
              >
                <FileText className="w-4 h-4" />
                {isBatchBusy
                  ? (isArabic ? 'جاري التحليل…' : 'Parsing Metadata…')
                  : (isArabic ? 'تحليل البيانات' : 'Parse Metadata')}
              </button>
            )}
            {canReconcile && (
              <button
                type="button"
                className="btn-secondary"
                onClick={reconcile}
                disabled={actionLoading === 'reconcile'}
              >
                {actionLoading === 'reconcile' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isArabic ? 'مطابقة' : 'Reconcile'}
              </button>
            )}
            {canFinalizeReconciliation && (
              <button
                type="button"
                className="btn-secondary"
                onClick={finalizeReconciliation}
                disabled={actionLoading === 'finalize-reconciliation'}
              >
                {actionLoading === 'finalize-reconciliation' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isArabic ? 'إنهاء المطابقة' : 'Finalize Reconciliation'}
              </button>
            )}
            {canApproveBatch && (
              <button
                type="button"
                className="btn-primary"
                onClick={approveBatch}
                disabled={actionLoading === 'approve'}
              >
                <CheckCircle className="w-4 h-4" />
                {isArabic ? 'الموافقة على الدفعة' : 'Approve Batch'}
              </button>
            )}
          </div>
          {batch?.reportObjectKey && (
            <button
              type="button"
              onClick={() => handleDownload(batch.reportObjectKey!)}
              className="text-blue-600 hover:text-blue-700 text-sm inline-flex items-center gap-1"
              disabled={downloadLoading === batch.reportObjectKey}
            >
              <FileText className="w-4 h-4" />
              {downloadLoading === batch.reportObjectKey
                ? (isArabic ? 'جاري التنزيل…' : 'Downloading…')
                : (isArabic ? 'تنزيل تقرير الاستيراد' : 'Download intake report')}
            </button>
          )}
        </CollapsibleCard>
      )}

      {(activeTab === 'overview' || activeTab === 'activity') && events.length > 0 && (
        <CollapsibleCard
          title={isArabic ? 'أحداث الدفعة' : 'Batch Events'}
          extra={<span className="text-sm text-gray-500">{events.length} {isArabic ? 'إدخالات' : 'entries'}</span>}
        >
          <div className="rounded-lg border border-gray-200 bg-gray-950 text-gray-100 max-h-80 overflow-auto">
            <div className="p-3 space-y-2 font-mono text-xs">
              {events.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <span className="text-gray-500 shrink-0">{new Date(event.createdAt).toLocaleTimeString()}</span>
                  <span className="text-sky-300">[{event.action}]</span>
                  <span className="text-gray-400 shrink-0">{event.actor}</span>
                  {event.detailJson && (
                    <span className="text-gray-100 break-all">
                      {(() => {
                        try {
                          const parsed = JSON.parse(event.detailJson) as { message?: string };
                          return parsed.message ?? event.detailJson;
                        } catch {
                          return event.detailJson;
                        }
                      })()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CollapsibleCard>
      )}

      {/* Matching — groups as primary element */}
      {(activeTab === 'overview' || activeTab === 'matching') && !isNormalizing && !isFailed && (
        <CollapsibleCard
          title={isArabic ? 'مطابقة المجموعات' : 'Group Matching'}
          extra={
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-3 py-1 font-medium ${matchedGroupKeys.size === detectedGroups.length && detectedGroups.length > 0 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                {matchedGroupKeys.size}/{detectedGroups.length} {isArabic ? 'مجموعة مطابقة' : 'groups matched'}
              </span>
              {unmatchedMetadataRows.length > 0 && (
                <span className="rounded-full px-3 py-1 font-medium bg-blue-100 text-blue-800">
                  {unmatchedMetadataRows.length} {isArabic ? 'صف بيانات بدون مجموعة' : 'metadata rows unmatched'}
                </span>
              )}
            </div>
          }
        >
          {/* Bulk action bar */}
          {selectedCandidates.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 flex-wrap">
              <span className="text-sm font-medium text-indigo-800">{selectedCandidates.size} {isArabic ? 'محدد' : 'selected'}</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'approved_existing', label: isArabic ? 'موجود' : 'Existing', cls: 'bg-green-600 hover:bg-green-700' },
                  { key: 'approved_new', label: isArabic ? 'جديد' : 'New', cls: 'bg-blue-600 hover:bg-blue-700' },
                  { key: 'parked_missing_files', label: isArabic ? 'إيقاف' : 'Park', cls: 'bg-amber-500 hover:bg-amber-600' },
                  { key: 'excluded_extra_source', label: isArabic ? 'استبعاد' : 'Exclude', cls: 'bg-gray-500 hover:bg-gray-600' },
                ].map(({ key, label, cls }) => (
                  <button key={key} type="button" disabled={actionLoading === 'bulk-decision'}
                    className={`rounded-full ${cls} px-3 py-1 text-xs font-medium text-white disabled:opacity-50`}
                    onClick={() => bulkSetDecision(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setSelectedCandidates(new Set())} className="ms-auto text-xs text-indigo-600 hover:text-indigo-800">
                {isArabic ? 'إلغاء التحديد' : 'Clear'}
              </button>
            </div>
          )}

          {/* Groups-first table */}
          <div className="space-y-3">
            {detectedGroups.length === 0 && candidates.length === 0 && (
              <p className="text-sm text-gray-500">{isArabic ? 'لا توجد مجموعات بعد. شغّل المطابقة أولاً.' : 'No groups yet. Run reconciliation first.'}</p>
            )}

            {detectedGroups.map((group) => {
              const candidate = candidates.find((c) => c.sourceGroupKey === group.groupKey) ?? null;
              const isSelected = candidate ? selectedCandidates.has(candidate.id) : false;
              const isEditingThis = candidate ? editingMetadata === candidate.id : false;
              const hasOverride = candidate?.metadataOverride && Object.keys(candidate.metadataOverride).length > 0;
              const metaFields: Array<{ key: string; label: string; labelAr: string; type?: string }> = [
                { key: 'title', label: 'Title', labelAr: 'العنوان' },
                { key: 'author', label: 'Author', labelAr: 'المؤلف' },
                { key: 'subtitle', label: 'Subtitle', labelAr: 'العنوان الفرعي' },
                { key: 'narrator', label: 'Narrator', labelAr: 'الراوي' },
                { key: 'isbn', label: 'ISBN', labelAr: 'ISBN' },
                { key: 'pubYear', label: 'Pub Year', labelAr: 'سنة النشر' },
                { key: 'genre', label: 'Genre', labelAr: 'النوع' },
                { key: 'sellingType', label: 'Selling Type', labelAr: 'نوع البيع' },
                { key: 'price', label: 'Price', labelAr: 'السعر', type: 'number' },
                { key: 'trackCount', label: 'Track Count', labelAr: 'عدد المقاطع', type: 'number' },
                { key: 'importancePoints', label: 'Importance', labelAr: 'الأهمية', type: 'number' },
              ];

              return (
                <div key={group.groupKey} className={`border rounded-lg overflow-hidden ${isSelected ? 'border-indigo-400' : candidate ? 'border-gray-200' : 'border-amber-200'}`}>
                  {/* Group header row */}
                  <div className={`px-4 py-3 flex items-start gap-3 ${candidate ? 'bg-gray-50' : 'bg-amber-50'}`}>
                    {candidate && (
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600"
                        checked={isSelected}
                        onChange={(e) => setSelectedCandidates((prev) => { const n = new Set(prev); e.target.checked ? n.add(candidate.id) : n.delete(candidate.id); return n; })}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{group.displayName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${candidate ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {candidate ? (isArabic ? 'مطابق' : 'matched') : (isArabic ? 'بلا بيانات' : 'no metadata')}
                        </span>
                        {candidate?.classificationDecision && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">{candidate.classificationDecision}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {group.items.length} {isArabic ? 'ملف' : 'files'} · {group.inferredTitle}
                        {group.reasons.length > 0 && ` · ${group.reasons.join(', ')}`}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {group.items.slice(0, 6).map((item) => (
                          <span key={item.key} className="rounded bg-white border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">{item.name}</span>
                        ))}
                        {group.items.length > 6 && <span className="text-[10px] text-gray-400">+{group.items.length - 6} {isArabic ? 'أكثر' : 'more'}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Unmatched group — assign a candidate */}
                  {!candidate && candidates.filter((c) => !c.sourceGroupKey).length > 0 && (
                    <div className="px-4 py-3 border-t border-amber-100 bg-amber-50/50">
                      <select
                        className="input text-sm w-full"
                        disabled={!canEditCandidateDecisions || !!actionLoading}
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) assignGroup(e.target.value, group.groupKey); }}
                      >
                        <option value="">{isArabic ? 'اختر بيانات لتعيينها…' : 'Assign metadata row…'}</option>
                        {candidates.filter((c) => !c.sourceGroupKey).map((c) => (
                          <option key={c.id} value={c.id}>
                            {isArabic ? `صف ${c.metadataRowIndex ?? '—'}: ` : `Row ${c.metadataRowIndex ?? '—'}: `}
                            {(c.metadataOverride?.title as string | undefined) ?? c.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Matched candidate details */}
                  {candidate && (
                    <div className="px-4 py-3 border-t border-gray-100">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{candidate.metadataOverride?.title as string ?? candidate.title}</span>
                            {hasOverride && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{isArabic ? 'معدّل' : 'overridden'}</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {isArabic ? 'صف ' : 'Row '}{candidate.metadataRowIndex ?? '—'}
                            {(candidate.metadataOverride?.author ?? candidate.author) && ` · ${candidate.metadataOverride?.author as string ?? candidate.author}`}
                            {(candidate.metadataOverride?.isbn ?? candidate.isbn) && ` · ISBN: ${candidate.metadataOverride?.isbn as string ?? candidate.isbn}`}
                          </p>
                          {candidate.decisionReason && <p className="mt-0.5 text-xs text-gray-400">{candidate.decisionReason}</p>}
                          {candidate.samawyCandidates.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {candidate.samawyCandidates.map((m, i) => (
                                <span key={i} className="badge-blue text-[10px]">{m.title} ({Math.round(m.confidence * 100)}%)</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Decision buttons */}
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          <button type="button" className={isEditingThis ? 'btn-primary text-xs py-1 px-2' : 'btn-secondary text-xs py-1 px-2'}
                            onClick={() => isEditingThis ? setEditingMetadata(null) : openMetadataEdit(candidate)}>
                            {isArabic ? (isEditingThis ? 'إلغاء' : 'تعديل') : (isEditingThis ? 'Cancel' : 'Edit')}
                          </button>
                          {[
                            { key: 'approved_existing', label: isArabic ? 'موجود' : 'Existing', icon: CheckCircle },
                            { key: 'approved_new', label: isArabic ? 'جديد' : 'New', icon: CheckCircle },
                            { key: 'parked_missing_files', label: isArabic ? 'إيقاف' : 'Park', icon: XCircle },
                            { key: 'excluded_extra_source', label: isArabic ? 'استبعاد' : 'Exclude', icon: XCircle },
                          ].map(({ key, label, icon: Icon }) => (
                            <button key={key} type="button" className="btn-secondary text-xs py-1 px-2"
                              onClick={() => setDecision(candidate.id, key)}
                              disabled={actionLoading === `decision-${candidate.id}` || !canEditCandidateDecisions}>
                              {actionLoading === `decision-${candidate.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Metadata edit form */}
                      {isEditingThis && (
                        <div className="mt-3 border-t border-gray-100 pt-3 space-y-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {metaFields.map((field) => (
                              <div key={field.key}>
                                <label className="block text-xs text-gray-500 mb-1">{isArabic ? field.labelAr : field.label}</label>
                                <input type={field.type ?? 'text'} className="input w-full text-sm"
                                  value={metadataForm[field.key] ?? ''}
                                  onChange={(e) => setMetadataForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                  placeholder={isArabic ? 'فارغ = بيانات أصلية' : 'blank = sheet value'} />
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button type="button" className="btn-primary text-sm" onClick={() => saveMetadata(candidate.id)}
                              disabled={actionLoading === `metadata-save-${candidate.id}`}>
                              {actionLoading === `metadata-save-${candidate.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                              {isArabic ? 'حفظ' : 'Save'}
                            </button>
                            <button type="button" className="btn-secondary text-sm" onClick={() => setEditingMetadata(null)}>
                              {isArabic ? 'إلغاء' : 'Cancel'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unmatched metadata rows (no group assigned) */}
            {unmatchedMetadataRows.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
                <p className="text-sm font-medium text-blue-900">{isArabic ? 'صفوف بيانات بدون مجموعة مصدر' : 'Metadata rows without a source group'}</p>
                <div className="flex flex-wrap gap-2">
                  {unmatchedMetadataRows.map((row) => (
                    <span key={row.rowIndex} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs text-blue-800">
                      {isArabic ? `صف ${row.rowIndex}: ` : `Row ${row.rowIndex}: `}{row.title || (isArabic ? 'بلا عنوان' : 'Untitled')}
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </CollapsibleCard>
      )}
    </div>
  );
}
