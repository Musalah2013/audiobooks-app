import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, CheckCircle2, Download, ExternalLink,
  Play, Scissors, Upload, Mic2, BookOpen, FileCheck2, CloudUpload,
  Edit3, ImageIcon, Save, Loader2,
} from 'lucide-react';
import { API_BASE, apiRequest, downloadFile, useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { BookDetailResponse, BookDetail } from '@api';

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || bytes === 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function computeDossierProgress(events: Array<{ action: string; detailJson: string | null }>): number {
  if (!events.length) return 2;
  const latest = events[0];
  const detail: Record<string, unknown> = latest.detailJson ? (() => { try { return JSON.parse(latest.detailJson) as Record<string, unknown>; } catch { return {}; } })() : {};
  switch (latest.action) {
    case 'dossier.started': return 5;
    case 'dossier.signing_urls': return 10;
    case 'dossier.packaging_start': return 15;
    case 'dossier.packaging_progress': {
      const downloaded = Number(detail.filesDownloaded ?? 0);
      const total = Number(detail.totalFiles ?? 1);
      return 15 + Math.round((downloaded / total) * 55);
    }
    case 'dossier.packaging_compressing': return 72;
    case 'dossier.packaging_uploading': return 80;
    case 'dossier.packaging_done': return 85;
    case 'dossier.cover': return 88;
    case 'dossier.building_workbook': return 93;
    case 'dossier.completed': return 100;
    default: return 2;
  }
}

type TabKey = 'prep' | 'sample' | 'dossier' | 'metadata' | 'logs';

interface MetaForm {
  title: string;
  subtitle: string;
  author: string;
  narrator: string;
  isbn: string;
  genre: string;
  blurb: string;
  pubYear: string;
  sellingType: string;
  price: string;
}

function bookToMetaForm(book: BookDetailResponse['book']): MetaForm {
  return {
    title: book?.title ?? '',
    subtitle: book?.subtitle ?? '',
    author: book?.author ?? '',
    narrator: book?.narrator ?? '',
    isbn: book?.isbn ?? '',
    genre: book?.genre ?? '',
    blurb: book?.blurb ?? '',
    pubYear: book?.pubYear ?? '',
    sellingType: book?.sellingType ?? '',
    price: book?.price != null ? String(book.price) : '',
  };
}

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<BookDetailResponse>(`/api/books/${id}`);
  const { data: meData } = useApi<{ user: { permissions: string[] } }>('/api/auth/me');
  const isAdmin = meData?.user.permissions.includes('users') ?? false;
  const { addToast } = useToast();
  const { isArabic } = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('prep');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sampleTrackId, setSampleTrackId] = useState('');
  const [sampleStartSeconds, setSampleStartSeconds] = useState(0);
  const [sampleEndSeconds, setSampleEndSeconds] = useState(30);
  const [editableTitles, setEditableTitles] = useState<Record<string, string>>({});
  const [metaForm, setMetaForm] = useState<MetaForm>({ title: '', subtitle: '', author: '', narrator: '', isbn: '', genre: '', blurb: '', pubYear: '', sellingType: '', price: '' });
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [revertBookConfirm, setRevertBookConfirm] = useState(false);
  const [clickupUrgent, setClickupUrgent] = useState(false);
  const [clickupStatusName, setClickupStatusName] = useState('');
  const [reuploadPercent, setReuploadPercent] = useState<number | null>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const activeStatuses = new Set(['queued', 'running', 'generating', 'building_dossier']);
    const currentStatus = data?.processingRun?.status ?? data?.book?.processingStatus;
    const dossierGenerating = data?.book?.dossierStatus === 'generating';
    const sampleGenerating = actionLoading === 'sample';
    if ((currentStatus && activeStatuses.has(currentStatus)) || dossierGenerating || sampleGenerating) {
      pollRef.current = setInterval(refetch, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [data?.processingRun?.status, data?.book?.processingStatus, data?.book?.dossierStatus, actionLoading, refetch]);

  useEffect(() => {
    if (!data?.tracks.length) return;
    setEditableTitles((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const t of data.tracks) {
        if (!(t.id in next)) {
          next[t.id] = t.finalTitle ?? t.originalDetectedTitle ?? t.originalFilename.replace(/\.[^/.]+$/, '');
        }
      }
      return next;
    });
  }, [data?.tracks]);

  useEffect(() => {
    if (!data?.tracks.length) return;
    const selected = data.book?.sampleTrackId
      ? data.tracks.find((t) => t.id === data.book?.sampleTrackId)
      : data.tracks.find((t) => t.finalObjectKey) ?? data.tracks[0];
    if (selected) {
      setSampleTrackId(selected.id);
      setSampleStartSeconds(data.book?.sampleStartSeconds ?? 0);
      setSampleEndSeconds(data.book?.sampleEndSeconds ?? Math.min(selected.finalDurationSeconds ?? 30, 30));
    }
  }, [data?.tracks, data?.book?.sampleTrackId, data?.book?.sampleStartSeconds, data?.book?.sampleEndSeconds]);

  // Sync metaForm when book data loads
  useEffect(() => {
    if (data?.book) setMetaForm(bookToMetaForm(data.book));
  }, [data?.book?.id]);

  const selectedTrack = useMemo(
    () => data?.tracks.find((t) => t.id === sampleTrackId) ?? null,
    [data?.tracks, sampleTrackId],
  );

  async function runAction(key: string, fn: () => Promise<void>) {
    setActionLoading(key);
    try { await fn(); refetch(); }
    catch (err) { addToast(err instanceof Error ? err.message : (isArabic ? 'حدث خطأ غير متوقع' : 'An unexpected error occurred'), 'error'); }
    finally { setActionLoading(null); }
  }

  async function handleDownload(objectKey: string, directUrl?: string) {
    setDownloadLoading(objectKey);
    try {
      if (directUrl) {
        const resp = await fetch(`${API_BASE}${directUrl}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const disposition = resp.headers.get('content-disposition') ?? '';
        const match = disposition.match(/filename="?([^"]+)"?/i);
        const filename = match?.[1] ?? 'download';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        await downloadFile(objectKey);
      }
    }
    catch (err) { addToast(err instanceof Error ? err.message : (isArabic ? 'فشل تنزيل الملف' : 'Failed to download file'), 'error'); }
    finally { setDownloadLoading(null); }
  }

  async function handleSaveMetadata() {
    await runAction('metadata', async () => {
      await apiRequest(`/api/books/${id}/metadata`, {
        method: 'PATCH',
        body: {
          title: metaForm.title || undefined,
          subtitle: metaForm.subtitle || null,
          author: metaForm.author || null,
          narrator: metaForm.narrator || null,
          isbn: metaForm.isbn || null,
          genre: metaForm.genre || null,
          blurb: metaForm.blurb || null,
          pubYear: metaForm.pubYear || null,
          sellingType: metaForm.sellingType || null,
          price: metaForm.price !== '' ? Number(metaForm.price) : null,
        },
      });
      addToast(isArabic ? 'تم حفظ البيانات الوصفية.' : 'Metadata saved.', 'success');
    });
  }

  async function handleReupload(file: File) {
    if (!/\.zip$/i.test(file.name)) {
      addToast(isArabic ? 'يُقبل فقط ملفات ZIP.' : 'Only ZIP files are accepted.', 'error');
      return;
    }
    setReuploadPercent(0);
    try {
      const { uploadUrl, objectKey } = await apiRequest<{ uploadUrl: string; objectKey: string }>(
        `/api/books/${id}/reupload-url`,
        { method: 'POST', body: { fileName: file.name, contentType: 'application/zip' } },
      );
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', 'application/zip');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setReuploadPercent(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Upload failed due to a network error'));
        xhr.send(file);
      });
      await apiRequest(`/api/books/${id}/finalize-reupload`, { method: 'POST', body: { objectKey } });
      addToast(isArabic ? 'تم رفع الملف البديل. أعد تجهيز التراكات.' : 'Replacement file uploaded. Re-prepare tracks.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل الرفع' : 'Upload failed'), 'error');
    } finally {
      setReuploadPercent(null);
      if (reuploadInputRef.current) reuploadInputRef.current.value = '';
    }
  }

  async function handleCoverUpload(file: File) {
    if (!file.type.startsWith('image/')) {
      addToast(isArabic ? 'يُقبل فقط ملفات الصور.' : 'Only image files are accepted.', 'error');
      return;
    }
    setActionLoading('cover');
    try {
      const resp = await fetch(`${API_BASE}/api/books/${id}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      addToast(isArabic ? 'تم رفع الغلاف.' : 'Cover uploaded.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل رفع الغلاف' : 'Failed to upload cover'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري تحميل العنوان…' : 'Loading book…'}</div>;

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 text-red-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {isArabic ? `فشل تحميل العنوان: ${error}` : `Failed to load book: ${error}`}
        </div>
      </div>
    );
  }

  const book = data?.book;
  const tracks = data?.tracks ?? [];
  const processingEvents = data?.processingEvents ?? [];
  const dossierEvents = (data?.dossierEvents ?? []).filter((e) => e.action.startsWith('dossier.'));
  const dossierProgress = book?.dossierStatus === 'generating' ? computeDossierProgress(dossierEvents) : (book?.dossierStatus === 'ready' ? 100 : 0);

  const canPrepareTracks = book?.processingStatus === 'pending' || tracks.length === 0;
  const canApproveTracks = tracks.length > 0 && tracks.some((t) => t.approvalStatus !== 'approved');
  const allTracksApproved = tracks.length > 0 && tracks.every((t) => t.approvalStatus === 'approved');
  const canStartProcessing = allTracksApproved && (book?.processingStatus === 'pending' || book?.processingStatus === 'failed');
  const isProcessing = ['queued', 'running'].includes(book?.processingStatus ?? '');
  const processingSucceeded = book?.processingStatus === 'succeeded';
  const canGenerateSample = processingSucceeded && !!selectedTrack?.finalObjectKey;
  const hasSample = !!book?.sampleObjectKey;
  const canFinalizeDossier = processingSucceeded && hasSample;
  const dossierReady = book?.dossierStatus === 'ready';
  const canSyncClickUp = dossierReady;

  const pipeline = [
    {
      key: 'tracks',
      icon: Mic2,
      label: isArabic ? 'التراكات' : 'Tracks',
      state: allTracksApproved ? 'done' : tracks.length > 0 ? 'active' : 'pending',
    },
    {
      key: 'processing',
      icon: Play,
      label: isArabic ? 'المعالجة' : 'Processing',
      state: processingSucceeded ? 'done' : isProcessing ? 'active' : book?.processingStatus === 'failed' ? 'error' : 'pending',
    },
    {
      key: 'sample',
      icon: Scissors,
      label: isArabic ? 'العينة' : 'Sample',
      state: hasSample ? 'done' : processingSucceeded ? 'active' : 'pending',
    },
    {
      key: 'dossier',
      icon: FileCheck2,
      label: isArabic ? 'الدوسيه' : 'Dossier',
      state: dossierReady ? 'done' : canFinalizeDossier ? 'active' : 'pending',
    },
    {
      key: 'clickup',
      icon: CloudUpload,
      label: 'ClickUp',
      state: book?.clickupSyncStatus === 'synced' ? 'done' : dossierReady ? 'active' : 'pending',
    },
  ];

  const nextAction =
    canPrepareTracks ? (isArabic ? 'جهّز التراكات أولاً لتبدأ سير العمل.' : 'Prepare tracks first to start the workflow.')
    : canApproveTracks ? (isArabic ? 'راجع التراكات واعتمدها لإتاحة بدء المعالجة.' : 'Review and approve tracks to unlock processing.')
    : canStartProcessing ? (isArabic ? 'كل التراكات معتمدة. ابدأ معالجة الصوت.' : 'All tracks approved. Start audio processing.')
    : isProcessing ? (isArabic ? 'المعالجة جارية… ستتحدث هذه الصفحة تلقائياً.' : 'Processing in progress… this page will update automatically.')
    : book?.processingStatus === 'failed' ? (isArabic ? 'فشلت المعالجة. تحقق من السجل وأعد المحاولة.' : 'Processing failed. Check the Log tab and retry.')
    : !hasSample && processingSucceeded ? (isArabic ? 'اذهب إلى تبويب العينة لتوليد مقتطف صوتي.' : 'Go to the Sample tab to generate an audio clip.')
    : canFinalizeDossier ? (isArabic ? 'العينة جاهزة. أنشئ الدوسيه النهائي.' : 'Sample ready. Create the final dossier.')
    : dossierReady && book?.clickupSyncStatus !== 'synced' ? (isArabic ? 'الدوسيه جاهز. زامن مع ClickUp.' : 'Dossier ready. Sync with ClickUp.')
    : (isArabic ? 'مكتمل.' : 'Completed.');

  const tabs: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
    { key: 'prep', label: isArabic ? 'التحضير' : 'Prep', icon: Mic2 },
    { key: 'sample', label: isArabic ? 'العينة' : 'Sample', icon: Scissors },
    { key: 'dossier', label: isArabic ? 'الدوسيه' : 'Dossier', icon: BookOpen },
    { key: 'metadata', label: isArabic ? 'البيانات' : 'Metadata', icon: Edit3 },
    { key: 'logs', label: isArabic ? 'السجل' : 'Log', icon: FileCheck2 },
  ];

  const metaField = (key: keyof MetaForm, label: string, opts?: { multiline?: boolean; type?: string; placeholder?: string }) => (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-1.5 block">{label}</span>
      {opts?.multiline ? (
        <textarea
          className="input min-h-[80px] resize-y"
          value={metaForm[key]}
          onChange={(e) => setMetaForm((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder={opts?.placeholder}
        />
      ) : (
        <input
          className="input"
          type={opts?.type ?? 'text'}
          value={metaForm[key]}
          onChange={(e) => setMetaForm((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder={opts?.placeholder}
        />
      )}
    </label>
  );

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <section className="card space-y-5">
        <div className="flex items-start gap-3">
          <Link to="/books" className="btn-secondary px-3 mt-0.5" title={isArabic ? 'العودة إلى قائمة الكتب' : 'Back to book list'}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-sky-700">{book?.publisherName}</p>
            <h1 className="mt-1 text-2xl font-black text-[color:var(--samawy-ink)] leading-tight">{book?.title}</h1>
            {book?.subtitle && <p className="mt-0.5 text-sm text-[color:var(--fg-2)]">{book.subtitle}</p>}
            {(book?.author || book?.narrator) && (
              <p className="mt-1 text-xs text-[color:var(--fg-2)]">
                {book.author && <span>{isArabic ? 'تأليف: ' : 'By: '}<strong>{book.author}</strong></span>}
                {book.author && book.narrator && <span className="mx-2 opacity-40">·</span>}
                {book.narrator && <span>{isArabic ? 'قراءة: ' : 'Narrated by: '}<strong>{book.narrator}</strong></span>}
              </p>
            )}
          </div>
        </div>

        {/* Pipeline steps */}
        <div className="flex items-center gap-0">
          {pipeline.map((step, i) => {
            const Icon = step.icon;
            const dotColor =
              step.state === 'done' ? 'bg-emerald-500' :
              step.state === 'active' ? 'bg-sky-500 animate-pulse' :
              step.state === 'error' ? 'bg-red-500' :
              'bg-slate-200';
            const labelColor =
              step.state === 'done' ? 'text-emerald-700' :
              step.state === 'active' ? 'text-sky-700 font-semibold' :
              step.state === 'error' ? 'text-red-600' :
              'text-[color:var(--fg-2)]';
            return (
              <div key={step.key} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <div className={`flex items-center justify-center rounded-full w-8 h-8 ${step.state === 'done' ? 'bg-emerald-50' : step.state === 'active' ? 'bg-sky-50' : step.state === 'error' ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <Icon className={`h-4 w-4 ${step.state === 'done' ? 'text-emerald-600' : step.state === 'active' ? 'text-sky-600' : step.state === 'error' ? 'text-red-500' : 'text-slate-400'}`} />
                  </div>
                  <span className={`text-[10px] text-center leading-tight truncate w-full px-1 ${labelColor}`}>{step.label}</span>
                  <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                </div>
                {i < pipeline.length - 1 && (
                  <div className="h-px flex-1 bg-slate-200 mb-5 mx-1" />
                )}
              </div>
            );
          })}
        </div>

        {/* Next action hint */}
        <div className="flex items-start gap-2 rounded-[16px] bg-[rgba(11,128,255,0.05)] px-4 py-3">
          <AlertCircle className="h-4 w-4 text-sky-600 mt-0.5 shrink-0" />
          <p className="text-sm text-sky-900 flex-1">{nextAction}</p>
        </div>

        {/* Revert */}
        {isAdmin && (book?.dossierStatus === 'ready' || book?.dossierStatus === 'failed' || book?.dossierStatus === 'generating' || book?.processingStatus === 'succeeded' || book?.processingStatus === 'failed' || book?.processingStatus === 'running' || (tracks.length > 0 && book?.processingStatus === 'pending')) && (
          revertBookConfirm ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <span className="text-red-800 font-medium flex-1">{isArabic ? 'هذا سيحذف بيانات المرحلة الحالية. تأكيد؟' : 'This will delete the current step\'s data. Confirm?'}</span>
              <button
                type="button"
                onClick={() => runAction('revert-book', async () => {
                  const result = await apiRequest<{ revertedFrom: string; revertedTo: string }>(`/api/books/${id}/revert`, { method: 'POST' });
                  addToast(isArabic ? `تم الرجوع: ${result.revertedFrom} → ${result.revertedTo}` : `Reverted: ${result.revertedFrom} → ${result.revertedTo}`, 'success');
                  setRevertBookConfirm(false);
                })}
                disabled={actionLoading === 'revert-book'}
                className="rounded-full bg-red-600 px-3 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isArabic ? 'نعم، تراجع' : 'Yes, revert'}
              </button>
              <button type="button" onClick={() => setRevertBookConfirm(false)} className="text-xs text-red-700 hover:text-red-900">
                {isArabic ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRevertBookConfirm(true)}
              className="self-start rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-red-300 hover:text-red-700"
            >
              {isArabic ? 'رجوع للخطوة السابقة' : 'Revert to previous step'}
            </button>
          )
        )}
      </section>

      {/* ── Tabs ── */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              className={`flex items-center gap-2 px-4 py-2 rounded-[14px] text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-[color:var(--samawy-blue)] text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-[color:var(--fg-2)] hover:border-[color:var(--samawy-blue)] hover:text-[color:var(--samawy-blue)]'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Prep tab ── */}
      {activeTab === 'prep' && (
        <div className="space-y-4">
          <section className="card space-y-4">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'خطوات التحضير' : 'Preparation steps'}</h3>
            <div className="flex flex-wrap gap-3">
              {tracks.length > 0 && !canPrepareTracks ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-[14px] text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  {isArabic ? 'تم تجهيز التراكات' : 'Tracks Prepared'}
                </span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={actionLoading === 'prepare' || !canPrepareTracks}
                    title={isArabic ? 'اكتشف التراكات الصوتية من الملفات المصدر وأنشئ قائمة أولية' : 'Detect audio tracks from the source files and build the initial list'}
                    onClick={() => runAction('prepare', async () => {
                      await apiRequest(`/api/books/${id}/prepare-tracks`, { method: 'POST' });
                      addToast(isArabic ? 'تم تجهيز التراكات.' : 'Tracks prepared.', 'success');
                    })}
                  >
                    {actionLoading === 'prepare' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {actionLoading === 'prepare'
                      ? (isArabic ? 'جاري الفحص…' : 'Inspecting…')
                      : (isArabic ? 'تجهيز التراكات' : 'Prepare Tracks')}
                  </button>
                  {actionLoading === 'prepare' && (
                    <p className="text-xs text-sky-600">{isArabic ? 'يتم فحص بنية الأرشيف، قد يستغرق بضع ثوانٍ…' : 'Inspecting archive structure, may take a few seconds…'}</p>
                  )}
                </div>
              )}
              {allTracksApproved ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-[14px] text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  {isArabic ? 'تم اعتماد التراكات' : 'Tracks Approved'}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={actionLoading === 'approve' || !canApproveTracks}
                  title={isArabic ? 'احفظ عناوين التراكات وترتيبها النهائي لإتاحة بدء المعالجة' : 'Lock track titles and order to unlock audio processing'}
                  onClick={() => runAction('approve', async () => {
                    await apiRequest(`/api/books/${id}/approve-tracks`, {
                      method: 'POST',
                      body: { tracks: tracks.map((t, i) => ({ id: t.id, finalTitle: (editableTitles[t.id] || t.finalTitle || t.originalFilename).trim(), finalOrderIndex: i + 1 })) },
                    });
                    addToast(isArabic ? 'تم اعتماد التراكات.' : 'Tracks approved.', 'success');
                  })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isArabic ? 'اعتماد التراكات' : 'Approve Tracks'}
                </button>
              )}
              {processingSucceeded ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-[14px] text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  {isArabic ? 'اكتملت المعالجة' : 'Processing Done'}
                </span>
              ) : isProcessing ? (
                <button type="button" className="btn-secondary opacity-60 cursor-not-allowed" disabled title={isArabic ? 'المعالجة جارية الآن' : 'Processing is currently running'}>
                  <Play className="h-4 w-4 animate-pulse" />
                  {isArabic ? 'المعالجة جارية…' : 'Processing…'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={actionLoading === 'process' || !canStartProcessing}
                  title={isArabic ? 'ابدأ تحويل الملفات الصوتية وضغطها في الحاوية' : 'Start transcoding and normalizing all approved audio tracks in the container'}
                  onClick={() => runAction('process', async () => {
                    await apiRequest(`/api/books/${id}/start-processing`, { method: 'POST' });
                    addToast(isArabic ? 'بدأت معالجة الصوت.' : 'Audio processing started.', 'success');
                  })}
                >
                  <Play className="h-4 w-4" />
                  {isArabic ? 'بدء المعالجة' : 'Start Processing'}
                </button>
              )}
            </div>
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-sky-700">
                <div className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                {isArabic ? 'معالجة الصوت جارية…' : 'Audio processing in progress…'}
              </div>
            )}
            {book?.processingStatus === 'failed' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  {isArabic ? 'فشلت المعالجة — راجع تبويب السجل للتفاصيل.' : 'Processing failed — check the Log tab for details.'}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={reuploadPercent !== null}
                    onClick={() => reuploadInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {reuploadPercent !== null
                      ? (isArabic ? `جاري الرفع ${reuploadPercent}%…` : `Uploading ${reuploadPercent}%…`)
                      : (isArabic ? 'رفع ملف ZIP بديل' : 'Upload replacement ZIP')}
                  </button>
                  <p className="text-xs text-[color:var(--fg-2)]">
                    {isArabic ? 'سيحل الملف الجديد محل التراكات الحالية.' : 'The new file will replace the current tracks.'}
                  </p>
                </div>
                <input
                  ref={reuploadInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReupload(f); }}
                />
              </div>
            )}
          </section>

          {/* Tracks table */}
          <section className="card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
              <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">
                {isArabic ? 'التراكات' : 'Tracks'}
                {tracks.length > 0 && <span className="ms-2 text-sm font-normal text-[color:var(--fg-2)]">({tracks.length})</span>}
              </h3>
              {tracks.length > 0 && (() => {
                const processedCount = tracks.filter((t) => t.finalObjectKey).length;
                const pct = Math.round((processedCount / tracks.length) * 100);
                return (
                  <div className="flex items-center gap-3 min-w-[180px]">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isProcessing ? 'bg-sky-500' : processedCount === tracks.length ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${isProcessing ? 'text-sky-700' : processedCount === tracks.length ? 'text-emerald-700' : 'text-[color:var(--fg-2)]'}`}>
                      {processedCount}/{tracks.length} {isArabic ? 'معالج' : 'processed'}
                    </span>
                  </div>
                );
              })()}
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-[rgba(11,128,255,0.03)] border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-start font-medium text-[color:var(--fg-2)]">#</th>
                  <th className="px-4 py-3 text-start font-medium text-[color:var(--fg-2)]">{isArabic ? 'اسم الملف' : 'Filename'}</th>
                  <th className="px-4 py-3 text-start font-medium text-[color:var(--fg-2)]">{isArabic ? 'الاسم النهائي' : 'Final Name'}</th>
                  <th className="px-4 py-3 text-start font-medium text-[color:var(--fg-2)]">{isArabic ? 'التفاصيل الأصلية' : 'Original'}</th>
                  <th className="px-4 py-3 text-start font-medium text-[color:var(--fg-2)]">{isArabic ? 'بعد المعالجة' : 'Processed'}</th>
                  <th className="px-4 py-3 text-start font-medium text-[color:var(--fg-2)]">{isArabic ? 'الاعتماد' : 'Approval'}</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track, i) => {
                  const processed = !!track.finalObjectKey;
                  const firstUnprocessedIdx = tracks.findIndex((t) => !t.finalObjectKey);
                  const isCurrentlyProcessing = isProcessing && !processed && i === firstUnprocessedIdx;
                  return (
                    <tr
                      key={track.id}
                      className={`border-b border-slate-100 last:border-0 transition-colors ${isCurrentlyProcessing ? 'bg-sky-50/60' : 'hover:bg-slate-50/50'}`}
                    >
                      <td className="px-4 py-3 text-[color:var(--fg-2)] text-xs tabular-nums">{track.finalOrderIndex ?? i + 1}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <span className="font-mono text-xs text-[color:var(--fg-2)] block break-all leading-snug" title={track.originalFilename}>
                          {track.originalFilename.includes('/') ? track.originalFilename.split('/').pop() : track.originalFilename}
                        </span>
                        {track.originalFilename.includes('/') && (
                          <span className="text-[10px] text-slate-400 block truncate">{track.originalFilename}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 min-w-[180px]">
                        {track.approvalStatus === 'approved' ? (
                          <span className="font-semibold text-[color:var(--samawy-ink)]">{editableTitles[track.id] ?? track.finalTitle ?? '—'}</span>
                        ) : (
                          <input
                            type="text"
                            className="input w-full text-sm py-1"
                            value={editableTitles[track.id] ?? ''}
                            onChange={(e) => setEditableTitles((prev) => ({ ...prev, [track.id]: e.target.value }))}
                            placeholder={track.originalFilename.replace(/\.[^/.]+$/, '')}
                            title={isArabic ? 'عنوان التراك النهائي كما سيظهر في الدوسيه' : 'Final track title as it will appear in the dossier'}
                          />
                        )}
                        {track.titleProvenance && track.titleProvenance !== 'manual' && track.approvalStatus !== 'approved' && (
                          <span className="mt-0.5 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{track.titleProvenance}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 min-w-[130px]">
                        <div className="space-y-0.5 text-xs tabular-nums text-[color:var(--fg-2)]">
                          <div>{formatDuration(track.originalDurationSeconds || null)}</div>
                          <div>{formatBytes(track.originalSizeBytes || null)}</div>
                          {track.originalBitrateKbps && <div>{track.originalBitrateKbps} kbps</div>}
                          {track.originalSampleRateHz && <div>{(track.originalSampleRateHz / 1000).toFixed(1)} kHz{track.originalChannels ? ` · ${track.originalChannels === 1 ? 'mono' : 'stereo'}` : ''}</div>}
                        </div>
                      </td>
                      <td className="px-4 py-3 min-w-[130px]">
                        {processed ? (
                          <div className="space-y-0.5 text-xs tabular-nums text-emerald-700">
                            <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />{formatDuration(track.finalDurationSeconds)}</div>
                            <div className="ps-4">{formatBytes(track.finalSizeBytes)}</div>
                            {track.finalBitrateKbps && <div className="ps-4">{track.finalBitrateKbps} kbps</div>}
                            {track.finalSampleRateHz && <div className="ps-4">{(track.finalSampleRateHz / 1000).toFixed(1)} kHz{track.finalChannels ? ` · ${track.finalChannels === 1 ? 'mono' : 'stereo'}` : ''}</div>}
                          </div>
                        ) : isCurrentlyProcessing ? (
                          <div className="space-y-0.5">
                            <span className="flex items-center gap-1.5 text-xs text-sky-700 font-medium">
                              <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse inline-block" />
                              {isArabic ? 'جاري…' : 'Working…'}
                            </span>
                            {processingEvents[0] && (() => {
                              const detail = processingEvents[0].detailJson ? (() => { try { return JSON.parse(processingEvents[0].detailJson) as { message?: string }; } catch { return null; } })() : null;
                              const msg = detail?.message ?? processingEvents[0].action;
                              return <span className="text-[10px] text-sky-500 break-all leading-snug line-clamp-2">{msg}</span>;
                            })()}
                          </div>
                        ) : (
                          <span className="text-xs text-[color:var(--fg-2)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={track.approvalStatus === 'approved' ? 'badge-green' : 'badge-yellow'}>{track.approvalStatus}</span>
                      </td>
                    </tr>
                  );
                })}
                {tracks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-[color:var(--fg-2)]">
                      <Mic2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                      {isArabic ? 'لا توجد تراكات بعد. اضغط «تجهيز التراكات» للبدء.' : 'No tracks yet. Click "Prepare Tracks" to start.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </section>
        </div>
      )}

      {/* ── Sample tab ── */}
      {activeTab === 'sample' && (
        <div className="grid gap-6 xl:grid-cols-[1fr,1.2fr]">
          <section className="card space-y-5">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'توليد العينة' : 'Generate Sample'}</h3>

            {!processingSucceeded && (
              <div className="rounded-[14px] bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                {isArabic ? 'أكمل معالجة الصوت أولاً قبل توليد العينة.' : 'Complete audio processing first before generating a sample.'}
              </div>
            )}

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-2 block">{isArabic ? 'اختر التراك' : 'Track'}</span>
              <select className="input" value={sampleTrackId} onChange={(e) => setSampleTrackId(e.target.value)} disabled={!processingSucceeded}>
                {tracks.filter((t) => t.finalObjectKey).map((t) => (
                  <option key={t.id} value={t.id}>{t.finalTitle ?? t.originalFilename}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-2 block">{isArabic ? 'البداية (ثانية)' : 'Start (sec)'}</span>
                <input className="input" type="number" min={0} value={sampleStartSeconds} onChange={(e) => setSampleStartSeconds(Number(e.target.value))} disabled={!processingSucceeded} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-2 block">{isArabic ? 'النهاية (ثانية)' : 'End (sec)'}</span>
                <input className="input" type="number" min={1} value={sampleEndSeconds} onChange={(e) => setSampleEndSeconds(Number(e.target.value))} disabled={!processingSucceeded} />
              </label>
            </div>

            <button
              type="button"
              className="btn-primary w-full"
              disabled={actionLoading === 'sample' || !canGenerateSample}
              title={isArabic ? 'اقطع مقتطفاً صوتياً من التراك المحدد وأضفه للدوسيه' : 'Cut a short audio clip from the selected track to include in the dossier'}
              onClick={() => runAction('sample', async () => {
                await apiRequest(`/api/books/${id}/generate-sample`, {
                  method: 'POST',
                  body: { trackId: sampleTrackId, startSeconds: sampleStartSeconds, endSeconds: sampleEndSeconds },
                });
                addToast(isArabic ? 'تم توليد العينة.' : 'Sample generated.', 'success');
              })}
            >
              {actionLoading === 'sample' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              {actionLoading === 'sample'
                ? (isArabic ? 'جاري توليد العينة…' : 'Generating sample…')
                : (isArabic ? 'توليد العينة' : 'Generate Sample')}
            </button>
            {actionLoading === 'sample' && (
              <div className="flex items-center gap-2 rounded-[12px] bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700">
                <div className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse shrink-0" />
                {isArabic ? 'يتم قطع المقتطف الصوتي في الحاوية…' : 'Cutting audio clip in the container…'}
              </div>
            )}

            {book?.sampleObjectKey && (
              <div className="space-y-3 rounded-[14px] bg-slate-950 p-4">
                <p className="text-xs text-slate-400">{isArabic ? 'العينة الحالية' : 'Current sample'}</p>
                <audio controls className="w-full" src={`${API_BASE}/api/files/${book.sampleObjectKey}?preview=1`} />
                <button
                  type="button"
                  className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
                  onClick={() => handleDownload(book.sampleObjectKey!)}
                  disabled={downloadLoading === book.sampleObjectKey}
                  title={isArabic ? 'تنزيل ملف العينة الصوتية' : 'Download the sample audio clip'}
                >
                  <Download className="h-3.5 w-3.5" />
                  {downloadLoading === book.sampleObjectKey ? (isArabic ? 'جاري التنزيل…' : 'Downloading…') : (isArabic ? 'تنزيل' : 'Download')}
                </button>
              </div>
            )}
          </section>

          <section className="card space-y-4">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'مستمع المعاينة' : 'Preview Player'}</h3>
            {selectedTrack?.finalObjectKey ? (
              <>
                <div className="rounded-[14px] bg-slate-950 p-4">
                  <p className="text-xs text-slate-400 mb-3 truncate">{selectedTrack.finalTitle ?? selectedTrack.originalFilename}</p>
                  <audio controls className="w-full" src={`${API_BASE}/api/files/${selectedTrack.finalObjectKey}?preview=1`} />
                </div>
                <p className="text-xs text-[color:var(--fg-2)]">
                  {isArabic
                    ? 'استمع ثم حدد بداية ونهاية المقتطف المراد تضمينه في الدوسيه.'
                    : 'Listen, then set the start and end of the clip to include in the dossier.'}
                </p>
              </>
            ) : (
              <div className="rounded-[14px] bg-slate-50 border border-slate-200 p-8 text-center">
                <Mic2 className="h-10 w-10 mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-[color:var(--fg-2)]">
                  {isArabic ? 'لا توجد نسخة معالجة متاحة بعد.' : 'No processed version available yet.'}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Dossier tab ── */}
      {activeTab === 'dossier' && (
        <div className="space-y-6">

          {/* Progress bar — shown while generating */}
          {book?.dossierStatus === 'generating' && (
            <section className="card space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">
                  {isArabic ? 'جاري إنشاء الدوسيه…' : 'Generating Dossier…'}
                </h3>
                <span className="text-sm font-semibold tabular-nums text-sky-700">{dossierProgress}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${dossierProgress}%` }}
                />
              </div>
              {dossierEvents.length > 0 && (
                <div className="log-panel max-h-48 overflow-auto rounded-[12px] p-3 space-y-1">
                  {[...dossierEvents].reverse().map((ev) => {
                    const detail: Record<string, unknown> = ev.detailJson ? (() => { try { return JSON.parse(ev.detailJson) as Record<string, unknown>; } catch { return {}; } })() : {};
                    const msg = typeof detail.message === 'string' ? detail.message : ev.action;
                    return (
                      <div key={ev.id} className="flex gap-3 text-xs">
                        <span className="shrink-0 text-sky-300 tabular-nums">{new Date(ev.createdAt).toLocaleTimeString()}</span>
                        <span className="text-slate-300 break-all">{msg}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-200 hover:bg-red-50"
                  disabled={actionLoading === 'reset-dossier'}
                  title={isArabic ? 'إعادة تعيين حالة الدوسيه إذا توقف الإنشاء وأصبح عالقاً' : 'Force-reset the dossier status if the workflow is stuck — you can then retry'}
                  onClick={() => runAction('reset-dossier', async () => {
                    await apiRequest(`/api/books/${id}/reset-dossier`, { method: 'POST' });
                    addToast(isArabic ? 'تم إعادة تعيين الدوسيه.' : 'Dossier reset — you can retry now.', 'success');
                  })}
                >
                  {isArabic ? 'إعادة تعيين (عالق؟)' : 'Reset if stuck'}
                </button>
              )}
            </section>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            {/* Finalize dossier */}
            <section className="card space-y-4">
              <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'إنهاء الدوسيه' : 'Finalize Dossier'}</h3>

              {!canFinalizeDossier && book?.dossierStatus !== 'generating' && (
                <div className="rounded-[14px] bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  {isArabic
                    ? 'يتطلب الدوسيه اكتمال المعالجة وتوليد العينة.'
                    : 'Dossier requires completed processing and a generated sample.'}
                </div>
              )}

              {book?.dossierStatus === 'generating' ? (
                <div className="flex items-center gap-2 w-full rounded-[14px] bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-700">
                  <div className="h-2 w-2 rounded-full bg-sky-500 animate-pulse shrink-0" />
                  {isArabic ? 'المعالجة جارية… راجع شريط التقدم أعلاه.' : 'In progress… see progress bar above.'}
                </div>
              ) : dossierReady ? (
                <div className="flex items-center gap-2 w-full rounded-[14px] bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-medium">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {isArabic ? 'الدوسيه جاهز' : 'Dossier ready'}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={actionLoading === 'dossier' || !canFinalizeDossier}
                  title={isArabic ? 'حزّم الملفات الصوتية والغلاف والبيانات الوصفية في ملف الدوسيه النهائي' : 'Package audio files, cover image, and metadata into the final delivery dossier'}
                  onClick={() => runAction('dossier', async () => {
                    await apiRequest(`/api/books/${id}/finalize-dossier`, { method: 'POST' });
                    addToast(isArabic ? 'بدأ إنشاء الدوسيه.' : 'Dossier generation started.', 'success');
                  })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isArabic ? 'إنشاء الدوسيه النهائي' : 'Create Final Dossier'}
                </button>
              )}

              {/* Retry button shown only when dossier failed */}
              {book?.dossierStatus === 'failed' && canFinalizeDossier && (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={actionLoading === 'dossier'}
                  title={isArabic ? 'إعادة محاولة إنشاء الدوسيه' : 'Retry dossier generation'}
                  onClick={() => runAction('dossier', async () => {
                    await apiRequest(`/api/books/${id}/finalize-dossier`, { method: 'POST' });
                    addToast(isArabic ? 'بدأ إنشاء الدوسيه.' : 'Dossier generation started.', 'success');
                  })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isArabic ? 'إعادة المحاولة' : 'Retry'}
                </button>
              )}
            </section>

            {/* ClickUp sync — separate from dossier creation */}
            <section className="card space-y-4">
              <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">ClickUp</h3>

              {!canSyncClickUp && (
                <div className="rounded-[14px] bg-slate-50 border border-slate-200 p-3 text-sm text-[color:var(--fg-2)]">
                  {isArabic ? 'المزامنة مع ClickUp متاحة فقط بعد اكتمال الدوسيه.' : 'ClickUp sync is available only after the dossier is ready.'}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-red-600 accent-red-600"
                  checked={clickupUrgent}
                  onChange={(e) => setClickupUrgent(e.target.checked)}
                  disabled={!canSyncClickUp}
                />
                <span className={`text-sm font-semibold ${clickupUrgent ? 'text-red-600' : 'text-[color:var(--fg-2)]'}`}>
                  {isArabic ? 'عاجل (أولوية قصوى)' : 'Urgent priority'}
                </span>
              </label>

              <div>
                <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1.5 block">
                  {isArabic ? 'حالة المهمة (اختياري)' : 'Task status (optional)'}
                </label>
                <input
                  className="input text-sm w-full"
                  value={clickupStatusName}
                  onChange={(e) => setClickupStatusName(e.target.value)}
                  placeholder={isArabic ? 'مثال: جاهز للنشر' : 'e.g. ready for publishing'}
                  disabled={!canSyncClickUp}
                  title={isArabic ? 'اترك فارغاً لاستخدام الحالة الافتراضية من إعدادات ClickUp' : 'Leave empty to use the default status from ClickUp settings'}
                />
              </div>

              <button
                type="button"
                className="btn-secondary w-full"
                disabled={actionLoading === 'clickup' || !canSyncClickUp}
                title={isArabic ? 'أنشئ مهمة ClickUp أو حدّثها بمعلومات الكتاب وروابط الدوسيه' : 'Create or update a ClickUp task with book info and dossier links'}
                onClick={() => runAction('clickup', async () => {
                  await apiRequest(`/api/books/${id}/clickup-sync`, { method: 'POST', body: { urgent: clickupUrgent, statusName: clickupStatusName.trim() || undefined } });
                  addToast(isArabic ? 'تمت مزامنة ClickUp.' : 'ClickUp synced.', 'success');
                })}
              >
                <CloudUpload className="h-4 w-4" />
                {isArabic ? 'مزامنة ClickUp' : 'Sync ClickUp'}
              </button>

              {book?.clickupTaskUrl && (
                <a
                  href={book.clickupTaskUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-[14px] border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                  title={isArabic ? 'افتح مهمة ClickUp الخاصة بهذا الكتاب في تبويب جديد' : 'Open this book\'s ClickUp task in a new tab'}
                >
                  <ExternalLink className="h-4 w-4" />
                  {isArabic ? 'فتح مهمة ClickUp' : 'Open ClickUp Task'}
                </a>
              )}

              {book?.clickupSyncError && (
                <div className="rounded-[14px] bg-red-50 border border-red-200 p-3 text-sm text-red-700">{book.clickupSyncError}</div>
              )}
            </section>
          </div>

          {/* Delivery files */}
          <section className="card space-y-4">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'ملفات التسليم' : 'Delivery Files'}</h3>

            {!dossierReady && book?.dossierStatus === 'generating' && (
              <div className="rounded-[14px] bg-slate-50 border border-slate-200 p-6 text-center text-sm text-[color:var(--fg-2)]">
                {isArabic ? 'ستظهر الملفات هنا عند الانتهاء.' : 'Files will appear here once generation completes.'}
              </div>
            )}
            {!dossierReady && book?.dossierStatus === 'failed' && (
              <div className="rounded-[14px] bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {isArabic ? 'فشل إنشاء الدوسيه — استخدم «إعادة المحاولة» في القسم أعلاه.' : 'Dossier generation failed — use "Retry" in the section above.'}
              </div>
            )}
            {!dossierReady && book?.dossierStatus !== 'generating' && book?.dossierStatus !== 'failed' && (
              <div className="rounded-[14px] bg-slate-50 border border-slate-200 p-8 text-center">
                <FileCheck2 className="h-10 w-10 mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-[color:var(--fg-2)]">{isArabic ? 'الدوسيه لم يُنشأ بعد.' : 'Dossier not created yet.'}</p>
              </div>
            )}

            {dossierReady && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleDownload('workbook', `/api/books/${id}/workbook`)}
                  disabled={downloadLoading === 'workbook'}
                  title={isArabic ? 'توليد وتنزيل ملف Excel يعكس أحدث البيانات الوصفية' : 'Generate and download an Excel file with the latest metadata'}
                >
                  <Download className="h-4 w-4" />
                  {downloadLoading === 'workbook' ? (isArabic ? 'جاري التوليد…' : 'Generating…') : (isArabic ? 'تنزيل بيانات Excel' : 'Download Excel Data')}
                </button>
                {book?.dossierAudioZipKey && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleDownload(book.dossierAudioZipKey!)}
                    disabled={downloadLoading === book.dossierAudioZipKey}
                    title={isArabic ? 'تنزيل ملف ZIP يحتوي على جميع التراكات المعالجة والعينة الصوتية' : 'Download the ZIP archive containing all processed tracks and the sample clip'}
                  >
                    <Download className="h-4 w-4" />
                    {isArabic ? 'تنزيل ملف الصوت النهائي' : 'Download Final Audio'}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Metadata tab ── */}
      {activeTab === 'metadata' && (
        <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">

          {/* Edit form */}
          <section className="card space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'تعديل البيانات الوصفية' : 'Edit Metadata'}</h3>
              <button
                type="button"
                className="btn-primary"
                disabled={actionLoading === 'metadata'}
                title={isArabic ? 'احفظ جميع التعديلات على البيانات الوصفية' : 'Save all metadata changes to the database'}
                onClick={handleSaveMetadata}
              >
                <Save className="h-4 w-4" />
                {actionLoading === 'metadata' ? (isArabic ? 'جاري الحفظ…' : 'Saving…') : (isArabic ? 'حفظ' : 'Save')}
              </button>
            </div>

            <div className="space-y-4">
              {metaField('title', isArabic ? 'العنوان *' : 'Title *', { placeholder: isArabic ? 'عنوان الكتاب' : 'Book title' })}
              {metaField('subtitle', isArabic ? 'العنوان الفرعي' : 'Subtitle', { placeholder: isArabic ? 'اختياري' : 'Optional' })}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {metaField('author', isArabic ? 'المؤلف' : 'Author', { placeholder: isArabic ? 'اسم المؤلف' : 'Author name' })}
                {metaField('narrator', isArabic ? 'الراوي' : 'Narrator', { placeholder: isArabic ? 'اسم الراوي' : 'Narrator name' })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {metaField('isbn', 'ISBN', { placeholder: '978-…' })}
                {metaField('genre', isArabic ? 'التصنيف' : 'Genre', { placeholder: isArabic ? 'مثال: رواية' : 'e.g. Fiction' })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {metaField('pubYear', isArabic ? 'سنة النشر' : 'Pub Year', { placeholder: '2024' })}
                {metaField('sellingType', isArabic ? 'نوع البيع' : 'Selling Type', { placeholder: isArabic ? 'مثال: مبيعات' : 'e.g. Sales' })}
                {metaField('price', isArabic ? 'السعر' : 'Price', { type: 'number', placeholder: '0.00' })}
              </div>

              {metaField('blurb', isArabic ? 'الوصف / النبذة' : 'Description / Blurb', { multiline: true, placeholder: isArabic ? 'نبذة قصيرة عن الكتاب…' : 'Short book description…' })}
            </div>
          </section>

          {/* Cover image */}
          <section className="card space-y-4">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'صورة الغلاف' : 'Cover Image'}</h3>

            {book?.coverObjectKey ? (
              <div className="space-y-3">
                <div className="rounded-[14px] overflow-hidden border border-slate-200 bg-slate-50">
                  <img
                    src={`${API_BASE}/api/files/${book.coverObjectKey}?preview=1`}
                    alt={book.title ?? 'Cover'}
                    className="w-full object-contain max-h-64"
                  />
                </div>
                <p className="text-xs text-[color:var(--fg-2)] font-mono break-all">{book.coverObjectKey.split('/').pop()}</p>
              </div>
            ) : (
              <div className="rounded-[14px] border-2 border-dashed border-slate-200 p-10 text-center">
                <ImageIcon className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-[color:var(--fg-2)]">
                  {isArabic ? 'لم يُعثر على صورة الغلاف في مصدر الملفات.' : 'No cover image found in the source files.'}
                </p>
              </div>
            )}

            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCoverUpload(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={actionLoading === 'cover'}
              title={isArabic ? 'ارفع صورة الغلاف من جهازك (JPEG أو PNG أو WebP)' : 'Upload a cover image from your computer (JPEG, PNG, or WebP)'}
              onClick={() => coverInputRef.current?.click()}
            >
              <ImageIcon className="h-4 w-4" />
              {actionLoading === 'cover'
                ? (isArabic ? 'جاري الرفع…' : 'Uploading…')
                : book?.coverObjectKey
                  ? (isArabic ? 'استبدال الغلاف' : 'Replace Cover')
                  : (isArabic ? 'رفع الغلاف' : 'Upload Cover')}
            </button>

            {book?.coverObjectKey && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => handleDownload(book.coverObjectKey!)}
                disabled={downloadLoading === book.coverObjectKey}
                title={isArabic ? 'تنزيل صورة الغلاف الحالية' : 'Download the current cover image'}
              >
                <Download className="h-4 w-4" />
                {isArabic ? 'تنزيل الغلاف' : 'Download Cover'}
              </button>
            )}
          </section>
        </div>
      )}

      {/* ── Log tab ── */}
      {activeTab === 'logs' && (
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'سجل المعالجة' : 'Processing Log'}</h3>
            <span className="text-xs text-[color:var(--fg-2)]">{processingEvents.length} {isArabic ? 'حدث' : 'events'}</span>
          </div>
          {(() => {
            const run = data?.processingRun;
            if (!run || (run.status !== 'failed_retryable' && run.status !== 'failed_blocking' && run.status !== 'failed')) return null;
            const errors: string[] = (() => {
              try {
                const r = run.resultJson ? JSON.parse(run.resultJson) as { errors?: string[] } : null;
                if (r?.errors?.length) return r.errors;
              } catch { /* ignore */ }
              try {
                const e = run.errorJson ? JSON.parse(run.errorJson) as { message?: string } | string : null;
                if (typeof e === 'string' && e) return [e];
                if (e && typeof e === 'object' && e.message) return [e.message];
              } catch {
                if (run.errorJson) return [run.errorJson];
              }
              return [];
            })();
            if (!errors.length) return null;
            return (
              <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-1">
                <p className="font-semibold">{isArabic ? 'أخطاء المعالجة:' : 'Processing errors:'}</p>
                {errors.map((e, i) => <p key={i} className="break-all">{e}</p>)}
              </div>
            );
          })()}
          <div className="log-panel max-h-[520px] overflow-auto p-4">
            {processingEvents.length === 0 && (
              <p className="text-center text-[color:var(--fg-2)] py-8">{isArabic ? 'لا توجد أحداث معالجة بعد.' : 'No processing events yet.'}</p>
            )}
            {processingEvents.map((event) => (
              <div key={event.id} className="flex gap-3 py-1">
                <span className="shrink-0 text-sky-300 tabular-nums">{new Date(event.createdAt).toLocaleTimeString()}</span>
                <span className="text-cyan-300 shrink-0">[{event.action}]</span>
                <span className="break-all">
                  {event.detailJson ? (() => {
                    try {
                      const parsed = JSON.parse(event.detailJson) as { message?: string };
                      return parsed.message ?? event.detailJson;
                    } catch { return event.detailJson; }
                  })() : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
