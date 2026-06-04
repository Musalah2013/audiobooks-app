import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Upload, Search, AlertCircle, FolderInput, FileArchive, FileSpreadsheet, Trash2 } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { BatchListItem } from '@api';

type BatchRouteView = 'new-batch' | 'intake' | 'metadata' | 'matching' | 'batches';

interface DirectMetadataForm {
  title: string;
  publisher: string;
  subtitle: string;
  genre: string;
  blurb: string;
  author: string;
  isbn: string;
  pubYear: string;
  sellingType: '' | 'subscription' | 'a_la_carte';
  price: string;
  trackCount: string;
  totalOriginalBookSizeBytes: string;
  totalLengthSeconds: string;
  narrator: string;
  importancePoints: string;
}

interface DrivePreview {
  ok: boolean;
  summary?: {
    totalFiles: number;
    totalSizeBytes: number;
    intakeMode: string;
    detectedGroups: number;
    skippedGoogleNativeCount: number;
  };
  groups?: Array<{
    groupKey: string;
    displayName: string;
    inferredTitle: string;
    itemCount: number;
    fileNames: string[];
    reasons: string[];
    confidence: number;
  }>;
  files?: Array<{
    key: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    parentPath: string;
  }>;
  error?: string;
  guidance?: string;
}

const EMPTY_DIRECT_METADATA: DirectMetadataForm = {
  title: '',
  publisher: '',
  subtitle: '',
  genre: '',
  blurb: '',
  author: '',
  isbn: '',
  pubYear: '',
  sellingType: '',
  price: '',
  trackCount: '',
  totalOriginalBookSizeBytes: '',
  totalLengthSeconds: '',
  narrator: '',
  importancePoints: '',
};

function toOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  return Number(value);
}

function uploadFileWithProgress(url: string, file: File, contentType: string, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed: ${request.status}`));
      }
    };
    request.onerror = () => reject(new Error('Upload failed due to a network error'));
    request.send(file);
  });
}

export default function Batches() {
  const { data, loading, error, refetch } = useApi<{ batches: BatchListItem[] }>('/api/dashboard');
  const { addToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { isArabic } = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [driveLink, setDriveLink] = useState('');
  const [driveWorkbook, setDriveWorkbook] = useState<File | null>(null);
  const [creatingDriveBatch, setCreatingDriveBatch] = useState(false);
  const [driveProgress, setDriveProgress] = useState('');
  const [driveUploadPercent, setDriveUploadPercent] = useState(0);
  const [drivePreview, setDrivePreview] = useState<DrivePreview | null>(null);
  const [previewingDrive, setPreviewingDrive] = useState(false);
  const [previewedDriveLink, setPreviewedDriveLink] = useState('');

  const [directZipFile, setDirectZipFile] = useState<File | null>(null);
  const [directMetadata, setDirectMetadata] = useState<DirectMetadataForm>(EMPTY_DIRECT_METADATA);
  const [creatingUploadBatch, setCreatingUploadBatch] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [directUploadPercent, setDirectUploadPercent] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const hasActiveBatch = (data?.batches ?? []).some((batch) => batch.status === 'intake_queued' || batch.status === 'normalizing');
    if (hasActiveBatch) {
      pollRef.current = setInterval(refetch, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [data?.batches, refetch]);

  function updateDirectMetadata<K extends keyof DirectMetadataForm>(key: K, value: DirectMetadataForm[K]) {
    setDirectMetadata((current) => ({ ...current, [key]: value }));
  }

  async function deleteOne(id: string) {
    setDeleting(true);
    try {
      await apiRequest(`/api/ingestions/${id}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف الدفعة.' : 'Batch deleted.', 'success');
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  async function deleteBulk() {
    const ids = [...selected];
    setDeleting(true);
    try {
      await apiRequest('/api/ingestions/bulk-delete', { method: 'POST', body: { ids } });
      addToast(isArabic ? `تم حذف ${ids.length} دفعة.` : `${ids.length} batches deleted.`, 'success');
      setSelected(new Set());
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  async function previewDrive() {
    if (!driveLink.trim()) {
      addToast(isArabic ? 'رابط Drive مطلوب' : 'Drive link is required', 'error');
      return;
    }
    setPreviewingDrive(true);
    setDrivePreview(null);
    try {
      const result = await apiRequest<DrivePreview>('/api/ingestions/preview-drive', {
        method: 'POST',
        body: { driveLink: driveLink.trim() },
      });
      setDrivePreview(result);
      setPreviewedDriveLink(driveLink.trim());
      addToast(isArabic ? 'تم تجهيز معاينة محتويات Drive' : 'Drive contents preview is ready', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview Drive';
      setDrivePreview({ ok: false, error: message });
      addToast(message, 'error');
    } finally {
      setPreviewingDrive(false);
    }
  }

  async function createDriveBatch() {
    if (!driveLink.trim()) {
      addToast(isArabic ? 'رابط Drive مطلوب' : 'Drive link is required', 'error');
      return;
    }
    if (!driveWorkbook) {
      addToast(isArabic ? 'أرفق ملف البيانات قبل بدء الاستيراد من Drive' : 'Attach the metadata workbook before starting Drive import', 'error');
      return;
    }
    if (!drivePreview?.ok || previewedDriveLink !== driveLink.trim()) {
      addToast(isArabic ? 'اعرض معاينة محتويات Drive أولاً قبل بدء الدفعة' : 'Preview the Drive contents first before starting the batch', 'error');
      return;
    }

    setCreatingDriveBatch(true);
    try {
      setDriveProgress('Creating batch...');
      const result = await apiRequest<{ batch: { id: string } }>('/api/ingestions', {
        method: 'POST',
        body: { sourceType: 'drive', driveLink: driveLink.trim() },
      });

      setDriveProgress('Getting workbook upload URL...');
      const uploadInfo = await apiRequest<{ uploadUrl: string; objectKey: string }>(
        `/api/ingestions/${result.batch.id}/metadata-upload-url`,
        {
          method: 'POST',
          body: {
            fileName: driveWorkbook.name,
            contentType: driveWorkbook.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        },
      );

      setDriveProgress('Uploading metadata workbook...');
      const driveUploadTarget = uploadInfo.uploadUrl.startsWith('http')
        ? uploadInfo.uploadUrl
        : `${API_BASE}${uploadInfo.uploadUrl}`;
      setDriveUploadPercent(0);
      await uploadFileWithProgress(
        driveUploadTarget,
        driveWorkbook,
        driveWorkbook.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        setDriveUploadPercent,
      );

      setDriveProgress('Attaching workbook...');
      await apiRequest(`/api/ingestions/${result.batch.id}/finalize-metadata-upload`, {
        method: 'POST',
        body: { objectKey: uploadInfo.objectKey },
      });

      setDriveProgress('Starting Drive import...');
      await apiRequest(`/api/ingestions/${result.batch.id}/start-intake`, { method: 'POST' });

      setDriveLink('');
      setDriveWorkbook(null);
      setDriveUploadPercent(0);
      navigate(`/batches/${result.batch.id}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل بدء استقبال Drive' : 'Failed to start Drive intake'), 'error');
      setDriveProgress('');
      setDriveUploadPercent(0);
    } finally {
      setCreatingDriveBatch(false);
    }
  }

  async function createDirectUploadBatch() {
    if (!directZipFile) {
      addToast(isArabic ? 'اختر ملف ZIP أولاً' : 'Choose a ZIP file first', 'error');
      return;
    }
    if (!/\.zip$/i.test(directZipFile.name)) {
      addToast(isArabic ? 'الاستقبال المباشر يقبل ZIP فقط' : 'Direct ingestion only accepts a ZIP file', 'error');
      return;
    }
    if (!directMetadata.title.trim() || !directMetadata.publisher.trim()) {
      addToast(isArabic ? 'العنوان والناشر مطلوبان' : 'Title and publisher are required', 'error');
      return;
    }

    setCreatingUploadBatch(true);
    try {
      setUploadProgress('Creating batch...');
      const result = await apiRequest<{ batch: { id: string } }>('/api/ingestions', {
        method: 'POST',
        body: { sourceType: 'upload' },
      });

      setUploadProgress('Saving metadata...');
      await apiRequest(`/api/ingestions/${result.batch.id}/manual-metadata`, {
        method: 'POST',
        body: {
          title: directMetadata.title.trim(),
          publisher: directMetadata.publisher.trim(),
          subtitle: directMetadata.subtitle.trim() || undefined,
          genre: directMetadata.genre.trim() || undefined,
          blurb: directMetadata.blurb.trim() || undefined,
          author: directMetadata.author.trim() || undefined,
          isbn: directMetadata.isbn.trim() || undefined,
          pubYear: directMetadata.pubYear.trim() || undefined,
          sellingType: directMetadata.sellingType || undefined,
          price: toOptionalNumber(directMetadata.price),
          trackCount: toOptionalNumber(directMetadata.trackCount),
          totalOriginalBookSizeBytes: toOptionalNumber(directMetadata.totalOriginalBookSizeBytes),
          totalLengthSeconds: toOptionalNumber(directMetadata.totalLengthSeconds),
          narrator: directMetadata.narrator.trim() || undefined,
          importancePoints: toOptionalNumber(directMetadata.importancePoints),
        },
      });

      setUploadProgress('Getting ZIP upload URL...');
      const uploadInfo = await apiRequest<{ uploadUrl: string; objectKey: string }>(
        `/api/ingestions/${result.batch.id}/direct-upload-url`,
        {
          method: 'POST',
          body: { fileName: directZipFile.name, contentType: directZipFile.type || 'application/zip' },
        },
      );

      setUploadProgress('Uploading ZIP...');
      const zipUploadTarget = uploadInfo.uploadUrl.startsWith('http')
        ? uploadInfo.uploadUrl
        : `${API_BASE}${uploadInfo.uploadUrl}`;
      setDirectUploadPercent(0);
      await uploadFileWithProgress(
        zipUploadTarget,
        directZipFile,
        directZipFile.type || 'application/zip',
        setDirectUploadPercent,
      );

      setUploadProgress('Finalizing ingestion...');
      await apiRequest(`/api/ingestions/${result.batch.id}/finalize-upload`, { method: 'POST' });

      setDirectZipFile(null);
      setDirectMetadata(EMPTY_DIRECT_METADATA);
      setDirectUploadPercent(0);
      navigate(`/batches/${result.batch.id}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل إنشاء دفعة الاستقبال المباشر' : 'Failed to create direct ingestion batch'), 'error');
      setUploadProgress('');
      setDirectUploadPercent(0);
    } finally {
      setCreatingUploadBatch(false);
    }
  }

  const pageCopy = useMemo(() => {
    switch (location.pathname) {
      case '/new-batch':
        return {
          title: isArabic ? 'بدء دفعة جديدة' : 'Start a new batch',
          subtitle: isArabic ? 'ابدأ فقط من أحد المسارين المعتمدين: Drive مع ملف Excel، أو ZIP منفرد مع نموذج بيانات يدوي.' : 'Start only from one of the two approved paths: Drive with a metadata workbook, or a single ZIP with manual metadata.',
        };
      case '/intake':
        return {
          title: isArabic ? 'الاستقبال والتطبيع' : 'Intake and normalization',
          subtitle: isArabic ? 'تابع حالات الاستقبال النشطة، التقدم في النسخ إلى R2، والتطبيع الأولي للملفات قبل أي خطوة لاحقة.' : 'Track active intake runs, copy progress into R2, and early file normalization before any downstream step.',
        };
      case '/metadata':
        return {
          title: isArabic ? 'تطبيع البيانات الوصفية' : 'Metadata normalization',
          subtitle: isArabic ? 'راجع مرحلة تحويل ملف Excel أو النموذج اليدوي إلى صفوف مهيكلة مع جاهزية القفل والمطابقة.' : 'Review the stage that converts the workbook or manual form into structured rows ready for seller lock and matching.',
        };
      case '/matching':
        return {
          title: isArabic ? 'المطابقة واعتماد العناوين' : 'Matching and approval',
          subtitle: isArabic ? 'هذه المرحلة تحصر الدُفعات التي وصلت إلى قفل البائع والمطابقة واعتماد القرارات قبل توليد السجل المرجعي.' : 'This stage isolates batches that reached seller lock, matching, and approval before the canonical catalog record is created.',
        };
      default:
        return {
          title: isArabic ? 'دفعات الاستقبال' : 'Intake batches',
          subtitle: isArabic ? 'هنا تبدأ كل الدُفعات وتُراجع مراحلها قبل أن تتحول إلى عناوين في الكتالوج المرجعي.' : 'All batches start here and move through gated stages before becoming canonical catalog titles.',
        };
    }
  }, [isArabic, location.pathname]);

  const routeView = useMemo<BatchRouteView>(() => {
    switch (location.pathname) {
      case '/new-batch':
        return 'new-batch';
      case '/intake':
        return 'intake';
      case '/metadata':
        return 'metadata';
      case '/matching':
        return 'matching';
      default:
        return 'batches';
    }
  }, [location.pathname]);

  const batches = data?.batches ?? [];
  const filteredBatches = useMemo(() => {
    switch (routeView) {
      case 'intake':
        return batches.filter((batch) => [
          'ingested',
          'intake_queued',
          'normalizing',
          'intake_failed',
          'normalized',
          'metadata_sheet_pending',
          'metadata_sheet_selected',
        ].includes(batch.status));
      case 'metadata':
        return batches.filter((batch) => [
          'parsing_metadata',
          'metadata_parsed',
          'seller_locked',
        ].includes(batch.status));
      case 'matching':
        return batches.filter((batch) => [
          'reconciliation_in_review',
          'reconciliation_approved',
          'records_created',
        ].includes(batch.status));
      case 'new-batch':
        return batches.slice(0, 10);
      default:
        return batches;
    }
  }, [batches, routeView]);

  const listTitle = useMemo(() => {
    switch (routeView) {
      case 'new-batch':
        return isArabic ? 'آخر الدُفعات' : 'Recent batches';
      case 'intake':
        return isArabic ? 'دفعات الاستقبال' : 'Intake batches';
      case 'metadata':
        return isArabic ? 'دفعات البيانات الوصفية' : 'Metadata batches';
      case 'matching':
        return isArabic ? 'دفعات المطابقة' : 'Matching batches';
      default:
        return isArabic ? 'كل الدُفعات' : 'All batches';
    }
  }, [isArabic, routeView]);

  const emptyState = useMemo(() => {
    switch (routeView) {
      case 'new-batch':
        return isArabic ? 'لا توجد دفعات بعد. ابدأ من أحد مساري الاستقبال بالأعلى.' : 'No batches yet. Start one from one of the two intake paths above.';
      case 'intake':
        return isArabic ? 'لا توجد دفعات حالياً في مراحل الاستقبال أو التطبيع.' : 'No batches are currently in intake or normalization stages.';
      case 'metadata':
        return isArabic ? 'لا توجد دفعات حالياً في مراحل تحليل البيانات أو قفل البائع.' : 'No batches are currently waiting in metadata parsing or seller-lock stages.';
      case 'matching':
        return isArabic ? 'لا توجد دفعات حالياً في مراحل المطابقة أو المراجعة بعدها.' : 'No batches are currently in matching or post-matching review stages.';
      default:
        return isArabic ? 'لا توجد دفعات.' : 'No batches found.';
    }
  }, [isArabic, routeView]);

  if (loading && data === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error && data === null) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="w-5 h-5" />
          <span>{isArabic ? `فشل تحميل الدفعات: ${error}` : `Failed to load batches: ${error}`}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="section-title">{pageCopy.title}</h1>
        <p className="section-subtitle">{pageCopy.subtitle}</p>
      </div>

      {routeView === 'new-batch' && (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="card space-y-4">
            <div className="flex items-start gap-3">
              <FolderInput className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{isArabic ? '١. استيراد Drive + ملف البيانات' : '1. Drive Import + Metadata Workbook'}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {isArabic
                    ? 'أدخل رابط مجلد Drive وملف بيانات Excel معاً. لن تبدأ الدفعة الاستيراد إلا بعد ربط كليهما.'
                    : 'Provide the Drive folder link and the metadata workbook together. The batch will only start importing after both are attached.'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{isArabic ? 'رابط مجلد Google Drive' : 'Google Drive folder link'}</label>
                <input
                  className="input w-full"
                  value={driveLink}
                  onChange={(e) => {
                    setDriveLink(e.target.value);
                    if (previewedDriveLink && previewedDriveLink !== e.target.value.trim()) {
                      setDrivePreview(null);
                    }
                  }}
                  placeholder="https://drive.google.com/drive/folders/..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{isArabic ? 'ملف البيانات' : 'Metadata workbook'}</label>
                <label className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4 cursor-pointer hover:border-blue-400">
                  <FileSpreadsheet className="w-5 h-5 text-gray-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {driveWorkbook ? driveWorkbook.name : (isArabic ? 'اختر .xlsx أو .xlsm أو .xls' : 'Choose .xlsx, .xlsm, or .xls')}
                    </p>
                    <p className="text-xs text-gray-500">{isArabic ? 'يُربط هذا الملف قبل بدء استيراد Drive.' : 'This workbook is attached before Drive import starts.'}</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xlsm,.xls"
                    onChange={(e) => setDriveWorkbook(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <button
                type="button"
                className="btn-secondary w-full"
                onClick={previewDrive}
                disabled={previewingDrive || !driveLink.trim()}
              >
                <Search className="w-4 h-4" />
                {previewingDrive ? (isArabic ? 'جاري المعاينة…' : 'Previewing Drive Contents…') : (isArabic ? 'معاينة محتويات Drive' : 'Preview Drive Contents')}
              </button>

              {drivePreview && (
                <div className={`rounded-lg border p-4 space-y-4 ${drivePreview.ok ? 'border-blue-200 bg-blue-50' : 'border-red-200 bg-red-50'}`}>
                  {drivePreview.ok ? (
                    <>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{isArabic ? 'عرض مرحلة ما قبل النسخ' : 'Pre-copy staging view'}</h3>
                        <p className="text-xs text-gray-600 mt-1">{isArabic ? 'هذا ما يمكن لحساب الخدمة رؤيته قبل نسخ أي ملف إلى R2.' : 'This is what the service account can see before any file is copied into R2.'}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg bg-white p-3">
                          <p className="text-xs text-gray-500">{isArabic ? 'الملفات المكتشفة' : 'Detected files'}</p>
                          <p className="mt-1 text-xl font-semibold text-gray-900">{drivePreview.summary?.totalFiles ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <p className="text-xs text-gray-500">{isArabic ? 'المجموعات المكتشفة' : 'Detected groups'}</p>
                          <p className="mt-1 text-xl font-semibold text-gray-900">{drivePreview.summary?.detectedGroups ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <p className="text-xs text-gray-500">{isArabic ? 'وضع الاستيراد' : 'Intake mode'}</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{drivePreview.summary?.intakeMode ?? (isArabic ? 'غير معروف' : 'unknown')}</p>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <p className="text-xs text-gray-500">{isArabic ? 'حجم المصدر المرئي' : 'Visible source size'}</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{Math.round((drivePreview.summary?.totalSizeBytes ?? 0) / 1024 / 1024)} MB</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-900">{isArabic ? 'المجموعات المكتشفة' : 'Detected groups'}</p>
                        <div className="space-y-2 max-h-72 overflow-auto">
                          {(drivePreview.groups ?? []).map((group) => (
                            <div key={group.groupKey} className="rounded-lg border border-blue-100 bg-white p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium text-gray-900">{group.displayName}</p>
                                  <p className="text-xs text-gray-500">{group.itemCount} {isArabic ? 'ملفات · العنوان المستنتج: ' : 'files · inferred title: '}{group.inferredTitle}</p>
                                </div>
                                <span className="text-xs text-blue-700">{Math.round(group.confidence * 100)}%</span>
                              </div>
                              <p className="mt-2 text-xs text-gray-500">{group.reasons.join(' · ')}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {group.fileNames.slice(0, 8).map((name) => (
                                  <span key={name} className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-900">{name}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-red-900">{isArabic ? 'فشل الوصول إلى Drive أو المعاينة' : 'Drive access or staging failed'}</p>
                      <p className="text-sm text-red-800">{drivePreview.error}</p>
                      {drivePreview.guidance ? <p className="text-xs text-red-700">{drivePreview.guidance}</p> : null}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                className="btn-primary w-full"
                onClick={createDriveBatch}
                disabled={creatingDriveBatch || !driveLink.trim() || !driveWorkbook || !drivePreview?.ok || previewedDriveLink !== driveLink.trim()}
              >
                <FolderInput className="w-4 h-4" />
                {creatingDriveBatch ? driveProgress || (isArabic ? 'جاري البدء...' : 'Starting...') : (isArabic ? 'بدء استيراد Drive' : 'Start Drive Intake')}
              </button>
              {creatingDriveBatch && driveUploadPercent > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>{isArabic ? 'رفع ملف البيانات' : 'Workbook upload'}</span>
                    <span>{driveUploadPercent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all duration-150" style={{ width: `${driveUploadPercent}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card space-y-4">
            <div className="flex items-start gap-3">
              <FileArchive className="w-5 h-5 text-purple-600 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{isArabic ? '٢. رفع ZIP مباشر + نموذج بيانات' : '2. Direct ZIP Upload + Metadata Form'}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {isArabic
                    ? 'ارفع ملف ZIP واحد لكتاب صوتي واحد وأدخل بياناته مباشرة هنا. يُنشئ هذا دفعة استقبال لكتاب واحد.'
                    : 'Upload one ZIP file for one audiobook and enter the book metadata directly here. This creates a single-book ingestion batch.'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{isArabic ? 'ملف ZIP للكتاب الصوتي' : 'Audiobook ZIP file'}</label>
                <label className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4 cursor-pointer hover:border-purple-400">
                  <Upload className="w-5 h-5 text-gray-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {directZipFile ? directZipFile.name : (isArabic ? 'اختر ملف .zip واحد' : 'Choose one .zip file')}
                    </p>
                    <p className="text-xs text-gray-500">{isArabic ? 'الاستقبال المباشر مقصور على ملف ZIP واحد.' : 'Direct intake is intentionally limited to a single ZIP source file.'}</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept=".zip"
                    onChange={(e) => setDirectZipFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <input className="input" value={directMetadata.title} onChange={(e) => updateDirectMetadata('title', e.target.value)} placeholder={isArabic ? 'العنوان *' : 'Title *'} />
                <input className="input" value={directMetadata.publisher} onChange={(e) => updateDirectMetadata('publisher', e.target.value)} placeholder={isArabic ? 'الناشر *' : 'Publisher *'} />
                <input className="input" value={directMetadata.subtitle} onChange={(e) => updateDirectMetadata('subtitle', e.target.value)} placeholder={isArabic ? 'العنوان الفرعي' : 'Subtitle'} />
                <input className="input" value={directMetadata.genre} onChange={(e) => updateDirectMetadata('genre', e.target.value)} placeholder={isArabic ? 'النوع الأدبي' : 'Genre'} />
                <input className="input" value={directMetadata.author} onChange={(e) => updateDirectMetadata('author', e.target.value)} placeholder={isArabic ? 'المؤلف' : 'Author'} />
                <input className="input" value={directMetadata.narrator} onChange={(e) => updateDirectMetadata('narrator', e.target.value)} placeholder={isArabic ? 'الراوي' : 'Narrator'} />
                <input className="input" value={directMetadata.isbn} onChange={(e) => updateDirectMetadata('isbn', e.target.value)} placeholder="ISBN" />
                <input className="input" value={directMetadata.pubYear} onChange={(e) => updateDirectMetadata('pubYear', e.target.value)} placeholder={isArabic ? 'سنة النشر' : 'Publication Year'} />
                <select className="input" value={directMetadata.sellingType} onChange={(e) => updateDirectMetadata('sellingType', e.target.value as DirectMetadataForm['sellingType'])}>
                  <option value="">{isArabic ? 'نوع البيع' : 'Selling Type'}</option>
                  <option value="subscription">{isArabic ? 'اشتراك' : 'Subscription'}</option>
                  <option value="a_la_carte">{isArabic ? 'بالقطعة' : 'A la carte'}</option>
                </select>
                <input className="input" value={directMetadata.price} onChange={(e) => updateDirectMetadata('price', e.target.value)} placeholder={isArabic ? 'السعر' : 'Price'} />
                <input className="input" value={directMetadata.trackCount} onChange={(e) => updateDirectMetadata('trackCount', e.target.value)} placeholder={isArabic ? 'عدد التراكات' : 'Track Count'} />
                <input className="input" value={directMetadata.totalLengthSeconds} onChange={(e) => updateDirectMetadata('totalLengthSeconds', e.target.value)} placeholder={isArabic ? 'المدة الإجمالية (ثانية)' : 'Total Length (seconds)'} />
                <input className="input" value={directMetadata.totalOriginalBookSizeBytes} onChange={(e) => updateDirectMetadata('totalOriginalBookSizeBytes', e.target.value)} placeholder={isArabic ? 'الحجم الأصلي (بايت)' : 'Original Size (bytes)'} />
                <input className="input" value={directMetadata.importancePoints} onChange={(e) => updateDirectMetadata('importancePoints', e.target.value)} placeholder={isArabic ? 'نقاط الأهمية' : 'Importance Points'} />
              </div>

              <textarea
                className="input min-h-28"
                value={directMetadata.blurb}
                onChange={(e) => updateDirectMetadata('blurb', e.target.value)}
                placeholder={isArabic ? 'نبذة عن الكتاب' : 'Blurb'}
              />

              <button
                type="button"
                className="btn-primary w-full"
                onClick={createDirectUploadBatch}
                disabled={creatingUploadBatch || !directZipFile || !directMetadata.title.trim() || !directMetadata.publisher.trim()}
              >
                <FileArchive className="w-4 h-4" />
                {creatingUploadBatch ? uploadProgress || (isArabic ? 'جاري البدء...' : 'Starting...') : (isArabic ? 'بدء استقبال ZIP المباشر' : 'Start Direct ZIP Intake')}
              </button>
              {creatingUploadBatch && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>{isArabic ? 'رفع ZIP' : 'ZIP upload'}</span>
                    <span>{directUploadPercent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-purple-100 overflow-hidden">
                    <div className="h-full bg-purple-600 transition-all duration-150" style={{ width: `${directUploadPercent}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900">{listTitle}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              confirmDelete === 'bulk' ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-700 font-medium">
                    {isArabic ? `حذف ${selected.size} دفعة؟` : `Delete ${selected.size} batch(es)?`}
                  </span>
                  <button type="button" className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={deleting} onClick={deleteBulk}>
                    {isArabic ? 'نعم' : 'Yes'}
                  </button>
                  <button type="button" className="text-xs text-gray-500 hover:text-gray-700" onClick={() => setConfirmDelete(null)}>
                    {isArabic ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-danger text-xs py-1.5 px-3" onClick={() => setConfirmDelete('bulk')}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {isArabic ? `حذف ${selected.size} محدد` : `Delete ${selected.size} selected`}
                </button>
              )
            )}
            <button type="button" className="btn-secondary" onClick={refetch}>
              <Search className="w-4 h-4" />
              {isArabic ? 'تحديث' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-3 px-4 w-8">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={filteredBatches.length > 0 && filteredBatches.every((b) => selected.has(b.id))}
                    onChange={(e) => setSelected((prev) => {
                      const n = new Set(prev);
                      filteredBatches.forEach((b) => e.target.checked ? n.add(b.id) : n.delete(b.id));
                      return n;
                    })}
                  />
                </th>
                <th className="text-start py-3 px-4 font-medium text-gray-500">ID</th>
                <th className="text-start py-3 px-4 font-medium text-gray-500">{isArabic ? 'المصدر' : 'Source'}</th>
                <th className="text-start py-3 px-4 font-medium text-gray-500">{isArabic ? 'البائع' : 'Seller'}</th>
                <th className="text-start py-3 px-4 font-medium text-gray-500">{isArabic ? 'الحالة' : 'Status'}</th>
                <th className="text-start py-3 px-4 font-medium text-gray-500">{isArabic ? 'وضع الاستقبال' : 'Intake Mode'}</th>
                <th className="text-start py-3 px-4 font-medium text-gray-500">{isArabic ? 'تاريخ الإنشاء' : 'Created'}</th>
                <th className="text-end py-3 px-4 font-medium text-gray-500">{isArabic ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.map((batch) => (
                <tr key={batch.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selected.has(batch.id) ? 'bg-red-50/40' : ''}`}>
                  <td className="py-3 px-4 w-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={selected.has(batch.id)}
                      onChange={(e) => setSelected((prev) => { const n = new Set(prev); e.target.checked ? n.add(batch.id) : n.delete(batch.id); return n; })}
                    />
                  </td>
                  <td className="py-3 px-4 font-mono text-gray-900">{batch.id.slice(0, 8)}</td>
                  <td className="py-3 px-4">
                    <span className={`badge-${batch.sourceType === 'drive' ? 'blue' : 'purple'}`}>
                      {batch.sourceType === 'drive' ? (isArabic ? 'Drive + ملف بيانات' : 'drive + workbook') : (isArabic ? 'ZIP + نموذج' : 'zip + form')}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-700">{batch.sellerName ?? '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`badge-${
                      batch.status === 'records_created' ? 'green' :
                      batch.status === 'intake_failed' ? 'red' :
                      batch.status === 'reconciliation_in_review' ? 'yellow' :
                      batch.status === 'normalized' || batch.status === 'metadata_sheet_pending' || batch.status === 'metadata_sheet_selected' || batch.status === 'parsing_metadata' || batch.status === 'metadata_parsed' || batch.status === 'seller_locked' ? 'blue' :
                      batch.status === 'intake_queued' || batch.status === 'normalizing' ? 'purple' : 'gray'
                    }`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500">{batch.intakeMode ?? '—'}</td>
                  <td className="py-3 px-4 text-gray-500">{new Date(batch.createdAt).toLocaleDateString()}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/batches/${batch.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                        {isArabic ? 'مراجعة ←' : 'Review →'}
                      </Link>
                      {confirmDelete === batch.id ? (
                        <div className="flex items-center gap-1">
                          <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={deleting} onClick={() => deleteOne(batch.id)}>
                            {isArabic ? 'تأكيد' : 'Confirm'}
                          </button>
                          <button type="button" className="text-[10px] text-gray-500 hover:text-gray-700" onClick={() => setConfirmDelete(null)}>
                            {isArabic ? 'إلغاء' : 'Cancel'}
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="text-red-400 hover:text-red-600 p-1 rounded" title={isArabic ? 'حذف' : 'Delete'} onClick={() => setConfirmDelete(batch.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredBatches.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-500">
                    {emptyState}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
