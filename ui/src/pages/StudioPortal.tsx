import { useRef, useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Download, Upload, CheckCircle2, FileText, Music, CloudUpload, Send, Loader2,
  Search, BookOpen, Package, Inbox, LogOut, Globe, ChevronDown,
  FileAudio, Hash, Calendar, AlertCircle, Clock
} from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';
import { AudioPlayer } from '../components/AudioPlayer';
import type { StudioPortalResponse } from '@api';

const API_BASE_URL = typeof API_BASE === 'string' ? API_BASE : '';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(d: string, isArabic: boolean) {
  return new Date(d).toLocaleDateString(isArabic ? 'ar-SA' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ status, isArabic }: { status: string; isArabic: boolean }) {
  const map: Record<string, { ar: string; en: string; bg: string; text: string; dot: string }> = {
    pending:   { ar: 'قيد الانتظار', en: 'Pending',   bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    approved:  { ar: 'موافقة',       en: 'Approved',  bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    refused:   { ar: 'مرفوضة',       en: 'Refused',   bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
    uploading: { ar: 'جاري الرفع',   en: 'Uploading', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    completed: { ar: 'مكتمل',        en: 'Completed', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    failed:    { ar: 'فشل',          en: 'Failed',    bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  };
  const info = map[status] ?? { ar: status, en: status, bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${info.bg} ${info.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
      {isArabic ? info.ar : info.en}
    </span>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
        active ? 'bg-[#0b80ff] text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Icon size={16} />
      {label}
      {count !== undefined && count > 0 && (
        <span className={`text-xs px-1.5 py-0.5 rounded-md ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
      )}
    </button>
  );
}

function SearchBar({ value, onChange, placeholder, dir }: { value: string; onChange: (v: string) => void; placeholder: string; dir: 'rtl' | 'ltr' }) {
  return (
    <div className="relative flex-1 min-w-[160px]">
      <Search className={`absolute ${dir === 'rtl' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-slate-400`} size={16} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full ${dir === 'rtl' ? 'pr-9 pl-4' : 'pl-9 pr-4'} py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0b80ff]/20 focus:border-[#0b80ff] transition-all`}
        dir={dir}
      />
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
        <Icon size={28} className="text-slate-300" />
      </div>
      <p className="text-slate-700 font-semibold text-sm mb-1">{title}</p>
      <p className="text-slate-400 text-xs">{subtitle}</p>
    </div>
  );
}

function LangToggle({ className = '' }: { className?: string }) {
  const { locale, toggleLocale } = useLocale();
  return (
    <button
      onClick={toggleLocale}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-all ${className}`}
    >
      <Globe size={14} />
      {locale === 'ar' ? 'EN' : 'ع'}
    </button>
  );
}

function LoginGate({ slug }: { slug: string }) {
  const { isArabic } = useLocale();
  const dir = isArabic ? 'rtl' : 'ltr';
  const t = (ar: string, en: string) => (isArabic ? ar : en);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function requestLink() {
    if (!email.trim()) return;
    setSending(true); setError('');
    try {
      await fetch(`${API_BASE_URL}/api/studio-auth/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, email: email.trim() }),
        credentials: 'include',
      });
      setSent(true);
    } catch {
      setError(t('حدث خطأ. يرجى المحاولة مرة أخرى.', 'Something went wrong. Please try again.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex items-center justify-center p-4" dir={dir}>
      <div className="absolute top-4 ltr:right-4 rtl:left-4"><LangToggle /></div>
      <div className="bg-white rounded-3xl max-w-md w-full p-12 shadow-xl shadow-slate-200/50 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
          <CloudUpload size={28} className="text-[#0b80ff]" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{t('بوابة سماوي للاستوديوهات', 'Samawy Studio Portal')}</h1>
        {sent ? (
          <div className="mt-6">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <p className="text-slate-600 leading-relaxed">{t('تم إرسال رابط الدخول إلى بريدك الإلكتروني. تحقق من بريدك وانقر على الرابط للدخول.', 'A sign-in link has been sent to your email. Check your inbox and click the link to sign in.')}</p>
          </div>
        ) : (
          <>
            <p className="text-slate-400 mb-7 text-sm leading-relaxed">{t('أدخل بريدك الإلكتروني المسجّل لتلقّي رابط الدخول.', 'Enter your registered email to receive a sign-in link.')}</p>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@studio.com"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#0b80ff]/20 focus:border-[#0b80ff] transition-all"
              dir="ltr"
              onKeyDown={(e) => e.key === 'Enter' && requestLink()}
            />
            {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
            <button
              onClick={requestLink}
              disabled={sending || !email.trim()}
              className="w-full py-3 bg-[#0b80ff] text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:bg-blue-600"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {sending ? t('جاري الإرسال…', 'Sending…') : t('إرسال رابط الدخول', 'Send sign-in link')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StudioPortal() {
  const { slug } = useParams<{ slug: string }>();
  const { isArabic } = useLocale();
  const dir = isArabic ? 'rtl' : 'ltr';
  const t = (ar: string, en: string) => (isArabic ? ar : en);
  const fd = (d: string) => formatDate(d, isArabic);

  const { data, loading, error, refetch } = useApi<StudioPortalResponse>(`/api/studio-portal/${slug}`);
  const [activeTab, setActiveTab] = useState<'overview' | 'assets' | 'production' | 'drive' | 'samples'>('overview');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bulk, setBulk] = useState<{ done: number; total: number; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [playingSampleId, setPlayingSampleId] = useState<string | null>(null);
  const [sampleUrls, setSampleUrls] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sampleSearch, setSampleSearch] = useState('');
  const [sampleBookFilter, setSampleBookFilter] = useState<string>('');
  const [sampleStatusFilter, setSampleStatusFilter] = useState<string>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedBookId, setSelectedBookId] = useState<string>('');
  const [deliveryTitleId, setDeliveryTitleId] = useState<string>('');
  const [deliveryNetHours, setDeliveryNetHours] = useState<string>('');
  const [deliveryNotes, setDeliveryNotes] = useState<string>('');
  const [planDraft, setPlanDraft] = useState<Record<string, { narrator: string; expectedNetHours: string; estimatedFinishHours: string }>>({});
  const [savingPlan, setSavingPlan] = useState<string | null>(null);

  const driveInputRef = useRef<HTMLInputElement>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);

  const studio = data?.studio;
  const assets = data?.assets ?? [];
  const productionFiles = data?.productionFiles ?? [];
  const samples = data?.samples ?? [];
  const driveUploads = data?.driveUploads ?? [];
  const assignedTitles = data?.assignedTitles ?? [];

  const filteredAssets = useMemo(() => {
    if (!searchQuery) return assets;
    return assets.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [assets, searchQuery]);

  const filteredProduction = useMemo(() => {
    if (!searchQuery) return productionFiles;
    return productionFiles.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [productionFiles, searchQuery]);

  const filteredSamples = useMemo(() => {
    return samples.filter((s) => {
      if (sampleSearch && !s.name.toLowerCase().includes(sampleSearch.toLowerCase())) return false;
      if (sampleStatusFilter && s.status !== sampleStatusFilter) return false;
      if (sampleBookFilter === '__none__') return !s.bookId;
      if (sampleBookFilter && s.bookId !== sampleBookFilter) return false;
      return true;
    });
  }, [samples, sampleSearch, sampleBookFilter, sampleStatusFilter]);

  // Group samples by their linked production file (assigned file), for the wrapped view.
  const groupedSamples = useMemo(() => {
    const groups = new Map<string, { key: string; bookName: string | null; items: typeof filteredSamples }>();
    for (const s of filteredSamples) {
      const key = s.bookId ?? '__none__';
      if (!groups.has(key)) groups.set(key, { key, bookName: s.bookName ?? null, items: [] });
      groups.get(key)!.items.push(s);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.key === '__none__') return 1;
      if (b.key === '__none__') return -1;
      return (a.bookName ?? '').localeCompare(b.bookName ?? '');
    });
  }, [filteredSamples]);

  const sampleBookOptions = useMemo(() => {
    const seen = new Map<string, string>();
    let hasUnlinked = false;
    for (const s of samples) {
      if (s.bookId) seen.set(s.bookId, s.bookName ?? s.bookId);
      else hasUnlinked = true;
    }
    return { books: [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), hasUnlinked };
  }, [samples]);

  const stats = useMemo(() => [
    { tab: 'assets' as const, label: t('الملفات المرجعية', 'Reference files'), value: assets.length, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
    { tab: 'production' as const, label: t('ملفات الإنتاج', 'Production files'), value: productionFiles.length, icon: FileText, color: 'text-rose-600', bg: 'bg-rose-50' },
    { tab: 'drive' as const, label: t('التسليمات', 'Deliveries'), value: driveUploads.length, icon: CloudUpload, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { tab: 'samples' as const, label: t('العينات', 'Samples'), value: samples.length, icon: Music, color: 'text-amber-600', bg: 'bg-amber-50' },
  ], [assets.length, productionFiles.length, driveUploads.length, samples.length, isArabic]);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showNotice(msg: string) {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 5000);
  }
  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  async function getDownloadUrl(objectKey: string): Promise<string> {
    const { url } = await apiRequest<{ url: string }>(`/api/studio-portal/${slug}/asset-download-url`, { method: 'POST', body: { objectKey } });
    return url;
  }
  async function getPdfDownloadUrl(objectKey: string): Promise<string> {
    const { url } = await apiRequest<{ url: string }>(`/api/studio-portal/${slug}/production-file-download-url`, { method: 'POST', body: { objectKey } });
    return url;
  }

  function xhrPut(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });
  }

  async function submitPlan(fileId: string) {
    const d = planDraft[fileId] ?? { narrator: '', expectedNetHours: '', estimatedFinishHours: '' };
    setSavingPlan(fileId);
    try {
      await apiRequest(`/api/studio-portal/${slug}/production-files/${fileId}/plan`, {
        method: 'POST',
        body: {
          narrator: d.narrator.trim() || null,
          expectedNetHours: d.expectedNetHours.trim() === '' ? null : Number(d.expectedNetHours),
          estimatedFinishHours: d.estimatedFinishHours.trim() === '' ? null : Number(d.estimatedFinishHours),
        },
      });
      showNotice(t('تم حفظ بيانات الإنتاج بنجاح.', 'Production details saved.'));
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : t('فشل حفظ البيانات', 'Failed to save'));
    } finally { setSavingPlan(null); }
  }

  async function handleDriveUpload(file: File) {
    setUploading(true); setUploadProgress(0);
    try {
      const { uploadUrl, uploadId } = await apiRequest<{ uploadUrl: string; uploadId: string }>(`/api/studio-portal/${slug}/drive-upload-url`, {
        method: 'POST',
        body: {
          fileName: file.name, contentType: file.type, sizeBytes: file.size,
          audiobookId: deliveryTitleId || null,
          netFinalHours: deliveryNetHours.trim() === '' ? null : Number(deliveryNetHours),
          notes: deliveryNotes.trim() || null,
        },
      });
      await xhrPut(uploadUrl, file);
      await apiRequest(`/api/studio-portal/${slug}/drive-uploads/${uploadId}/complete`, { method: 'POST' });
      setDeliveryNetHours(''); setDeliveryNotes('');
      showNotice(deliveryTitleId ? t('تم تسليم الصوت النهائي للعنوان المحدد بنجاح.', 'Final audio delivered for the selected title.') : t('تم رفع الملف بنجاح وسيراجعه الفريق.', 'File uploaded — the team will review it.'));
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : t('فشل الرفع', 'Upload failed'));
    } finally {
      setUploading(false); setUploadProgress(0);
    }
  }

  // Bulk sample upload — all linked to the selected book.
  async function handleSampleUpload(files: File[]) {
    if (!selectedBookId) { showNotice(t('يرجى اختيار الكتاب أولاً', 'Please select a book first')); return; }
    const list = files.filter(Boolean);
    if (!list.length) return;
    setUploading(true);
    let ok = 0; const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setBulk({ done: i, total: list.length, name: file.name });
      setUploadProgress(0);
      try {
        const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/api/studio-portal/${slug}/sample-upload-url`, {
          method: 'POST',
          body: { fileName: file.name, contentType: file.type, sizeBytes: file.size, bookId: selectedBookId },
        });
        await xhrPut(uploadUrl, file);
        ok += 1;
      } catch { failed.push(file.name); }
    }
    setBulk(null); setUploading(false); setUploadProgress(0);
    showNotice(failed.length
      ? `${t('تم رفع', 'Uploaded')} ${ok}/${list.length}. ${t('فشل:', 'Failed:')} ${failed.join(', ')}`
      : `${t('تم رفع', 'Uploaded')} ${ok} ${t('عينة', 'sample(s)')}.`);
    setSelectedBookId('');
    refetch();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center" dir={dir}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-[#0b80ff] animate-spin" />
          <p className="text-slate-500 text-sm">{t('جاري التحميل…', 'Loading…')}</p>
        </div>
      </div>
    );
  }

  if (error?.includes('401') || error?.includes('Unauthorized')) return <LoginGate slug={slug ?? ''} />;
  if (!data) {
    return (
      <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center" dir={dir}>
        <div className="bg-white rounded-2xl p-8 shadow-lg max-w-md w-full mx-4">
          <p className="text-red-500 font-semibold mb-2">{t('خطأ في تحميل البيانات', 'Failed to load data')}</p>
          <p className="text-slate-500 text-sm mb-4">{error || t('لم يتم استلام بيانات من الخادم', 'No data received from the server')}</p>
          <button onClick={() => location.reload()} className="mt-4 w-full py-2 bg-[#0b80ff] text-white rounded-xl text-sm font-semibold">{t('إعادة المحاولة', 'Retry')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa]" dir={dir}>
      {notice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-2xl text-sm z-50 shadow-xl shadow-slate-900/20 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-400" />
          {notice}
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
          {studio?.logoObjectKey ? (
            <img src={`${API_BASE_URL}/api/files/${studio?.logoObjectKey}?preview=1`} alt={studio?.name ?? ''} className="h-10 w-10 object-cover rounded-xl border border-slate-100" />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center"><BookOpen size={20} className="text-[#0b80ff]" /></div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-900 truncate">{studio?.name ?? '—'}</h1>
            <p className="text-xs text-slate-400">{t('بوابة سماوي للاستوديوهات', 'Samawy Studio Portal')}</p>
          </div>
          <LangToggle />
          <button
            onClick={() => fetch(`${API_BASE_URL}/api/studio-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-all"
          >
            <LogOut size={14} />
            {t('خروج', 'Sign out')}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex gap-2 overflow-x-auto">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={Inbox} label={t('نظرة عامة', 'Overview')} />
          <TabButton active={activeTab === 'assets'} onClick={() => setActiveTab('assets')} icon={Package} label={t('المرجعيات', 'References')} count={assets.length} />
          <TabButton active={activeTab === 'production'} onClick={() => setActiveTab('production')} icon={FileText} label={t('الإنتاج', 'Production')} count={productionFiles.length} />
          <TabButton active={activeTab === 'drive'} onClick={() => setActiveTab('drive')} icon={CloudUpload} label={t('التسليمات', 'Deliveries')} count={driveUploads.length} />
          <TabButton active={activeTab === 'samples'} onClick={() => setActiveTab('samples')} icon={Music} label={t('العينات', 'Samples')} count={samples.length} />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats.map((s) => (
                <button
                  key={s.tab}
                  onClick={() => setActiveTab(s.tab)}
                  className="bg-white rounded-2xl p-5 border border-slate-100 hover:border-slate-200 hover:shadow-md transition-all text-start"
                >
                  <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
                    <s.icon size={20} className={s.color} />
                  </div>
                  <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                  <p className="text-xs text-slate-400 mt-1">{s.label}</p>
                </button>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-4">{t('آخر النشاطات', 'Recent activity')}</h2>
              {driveUploads.length === 0 && samples.length === 0 ? (
                <EmptyState icon={Inbox} title={t('لا يوجد نشاط حالياً', 'No activity yet')} subtitle={t('ستظهر هنا آخر الملفات المرفوعة والعينات.', 'Your recent uploads and samples will appear here.')} />
              ) : (
                <div className="space-y-3">
                  {[...driveUploads, ...samples]
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 10)
                    .map((item) => (
                      <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${'status' in item ? 'bg-amber-50' : 'bg-blue-50'}`}>
                          {'status' in item ? <Music size={16} className="text-amber-500" /> : <CloudUpload size={16} className="text-blue-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{item.name}</p>
                          <p className="text-xs text-slate-400">{fd(item.createdAt)}</p>
                        </div>
                        {'status' in item && <StatusBadge status={(item as { status: string }).status} isArabic={isArabic} />}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assets */}
        {activeTab === 'assets' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-5">
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder={t('البحث في الملفات المرجعية...', 'Search reference files…')} dir={dir} />
              <span className="text-xs text-slate-400 whitespace-nowrap">{filteredAssets.length} {t('ملف', 'files')}</span>
            </div>
            {filteredAssets.length === 0 ? (
              <EmptyState icon={Package} title={t('لا توجد ملفات مرجعية', 'No reference files')} subtitle={t('ملفات رفعها فريق سماوي لمرجعيتك ستظهر هنا.', 'Files shared by the Samawy team will appear here.')} />
            ) : (
              <div className="grid gap-3">
                {filteredAssets.map((a) => (
                  <div key={a.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all bg-white">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><FileText size={18} className="text-blue-500" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{a.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400 flex items-center gap-1"><Hash size={12} /> {formatBytes(a.sizeBytes)}</span>
                        <span className="text-xs text-slate-400 flex items-center gap-1"><Calendar size={12} /> {fd(a.createdAt)}</span>
                      </div>
                    </div>
                    <button onClick={async () => { const url = await getDownloadUrl(a.objectKey); window.open(url, '_blank'); }} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-all">
                      <Download size={14} /> {t('تنزيل', 'Download')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Production */}
        {activeTab === 'production' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-5">
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder={t('البحث في ملفات الإنتاج...', 'Search production files…')} dir={dir} />
              <span className="text-xs text-slate-400 whitespace-nowrap">{filteredProduction.length} {t('ملف', 'files')}</span>
            </div>
            {filteredProduction.length === 0 ? (
              <EmptyState icon={FileText} title={t('لا توجد ملفات إنتاج', 'No production files')} subtitle={t('ملفات أرسلها إليك فريق سماوي لمتابعة الإنتاج.', 'Files the Samawy team shares for production will appear here.')} />
            ) : (
              <div className="grid gap-3">
                {filteredProduction.map((f) => {
                  const d = planDraft[f.id] ?? {
                    narrator: f.narrator ?? '',
                    expectedNetHours: f.expectedNetHours != null ? String(f.expectedNetHours) : '',
                    estimatedFinishHours: f.estimatedFinishHours != null ? String(f.estimatedFinishHours) : '',
                  };
                  const setField = (k: 'narrator' | 'expectedNetHours' | 'estimatedFinishHours', v: string) => setPlanDraft((prev) => ({ ...prev, [f.id]: { ...d, [k]: v } }));
                  const showPlan = !!f.audiobookId && !!f.hasApprovedSample;
                  return (
                    <div key={f.id} className="p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all bg-white">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0"><FileText size={18} className="text-rose-500" /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{f.name}</p>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {f.audiobookTitle && <span className="text-xs text-blue-600 flex items-center gap-1"><BookOpen size={12} /> {f.audiobookTitle}</span>}
                            <span className="text-xs text-slate-400 flex items-center gap-1"><Hash size={12} /> {formatBytes(f.sizeBytes)}</span>
                            <span className="text-xs text-slate-400 flex items-center gap-1"><Calendar size={12} /> {fd(f.createdAt)}</span>
                          </div>
                        </div>
                        <button onClick={async () => { const url = await getPdfDownloadUrl(f.objectKey); window.open(url, '_blank'); }} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-all flex-shrink-0">
                          <Download size={14} /> {t('تنزيل', 'Download')}
                        </button>
                      </div>

                      {showPlan && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <p className="text-xs font-semibold text-slate-600 mb-2">{t('بيانات الإنتاج (بعد اعتماد العينة)', 'Production details (after sample approval)')}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">{t('الراوي', 'Narrator')}</label>
                              <input className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm" value={d.narrator} onChange={(e) => setField('narrator', e.target.value)} placeholder={t('اسم الراوي', 'Narrator name')} />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">{t('الساعات الصافية المتوقعة', 'Expected net hours')}</label>
                              <input className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm" type="number" min="0" step="0.1" value={d.expectedNetHours} onChange={(e) => setField('expectedNetHours', e.target.value)} placeholder="0" />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">{t('ساعات الإنجاز المقدّرة', 'Estimated finish hours')}</label>
                              <input className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm" type="number" min="0" step="0.1" value={d.estimatedFinishHours} onChange={(e) => setField('estimatedFinishHours', e.target.value)} placeholder="0" />
                            </div>
                          </div>
                          <button onClick={() => submitPlan(f.id)} disabled={savingPlan === f.id} className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-[#0b80ff] text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-blue-600 transition-all">
                            <CheckCircle2 size={14} /> {savingPlan === f.id ? t('جاري الحفظ…', 'Saving…') : t('حفظ بيانات الإنتاج', 'Save production details')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Deliveries */}
        {activeTab === 'drive' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-1">{t('تسليم الصوت النهائي', 'Deliver final audio')}</h2>
              <p className="text-xs text-slate-400 mb-4">{t('ارفع ملفات الكتاب الصوتي النهائية. اختر العنوان المُسنَد إليك لإرساله مباشرةً إلى المعالجة، أو اتركه دون تحديد لمراجعة الفريق.', 'Upload the finished audiobook files. Pick an assigned title to send it straight to processing, or leave it unselected for the team to review.')}</p>
              {assignedTitles.length > 0 && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('العنوان المُسنَد (اختياري)', 'Assigned title (optional)')}</label>
                  <select value={deliveryTitleId} onChange={(e) => setDeliveryTitleId(e.target.value)} className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" dir={dir}>
                    <option value="">{t('— بدون عنوان (مراجعة الفريق) —', '— No title (team review) —')}</option>
                    {assignedTitles.map((ti) => (<option key={ti.audiobookId} value={ti.audiobookId}>{ti.title}</option>))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('الساعات الصافية النهائية', 'Final net hours')}</label>
                  <input className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" type="number" min="0" step="0.1" value={deliveryNetHours} onChange={(e) => setDeliveryNetHours(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('ملاحظات (اختياري)', 'Notes (optional)')}</label>
                  <input className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} placeholder={t('أي ملاحظات حول الملف', 'Any notes about the file')} />
                </div>
              </div>
              <input type="file" ref={driveInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDriveUpload(f); }} />
              <div className="flex items-center gap-4">
                <button disabled={uploading} onClick={() => driveInputRef.current?.click()} className="flex items-center gap-2 px-5 py-3 bg-[#0b80ff] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-600 transition-all">
                  <CloudUpload size={18} />
                  {uploading ? t('جاري الرفع…', 'Uploading…') : t('اختيار ملف', 'Choose file')}
                </button>
                {uploading && !bulk && (
                  <div className="flex-1 max-w-xs">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#0b80ff] rounded-full transition-transform origin-left" style={{ transform: `scaleX(${uploadProgress / 100})` }} /></div>
                    <p className="text-xs text-slate-400 mt-1">{uploadProgress}%</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-4">{t('الملفات المرفوعة', 'Uploaded files')}</h2>
              {driveUploads.length === 0 ? (
                <EmptyState icon={CloudUpload} title={t('لم يتم رفع أي ملفات', 'No files uploaded')} subtitle={t('الملفات التي ترفعها ستظهر هنا مع حالتها.', 'Files you upload will appear here with their status.')} />
              ) : (
                <div className="grid gap-3">
                  {driveUploads.map((d) => (
                    <div key={d.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0"><CloudUpload size={18} className="text-emerald-500" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{d.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{fd(d.createdAt)}</p>
                      </div>
                      <StatusBadge status={d.status} isArabic={isArabic} />
                      {d.error && (<span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} /> {d.error}</span>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Samples */}
        {activeTab === 'samples' && (
          <div className="space-y-4">
            {/* Upload */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-1">{t('العينات الصوتية', 'Audio samples')}</h2>
              <p className="text-xs text-slate-400 mb-4">{t('اختر الكتاب أولاً، ثم ارفع عينة أو أكثر مرتبطة به.', 'Select a book first, then upload one or more samples linked to it.')}</p>

              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">{t('الكتاب المرتبط بالعينة', 'Book the sample is for')}</label>
                <select value={selectedBookId} onChange={(e) => setSelectedBookId(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b80ff]/20 focus:border-[#0b80ff] transition-all" dir={dir}>
                  <option value="">{t('اختر كتاباً من ملفات الإنتاج…', 'Choose a book from production files…')}</option>
                  {productionFiles.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
              </div>

              <input type="file" multiple ref={sampleInputRef} className="hidden" accept="audio/*" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) handleSampleUpload(fs); e.target.value = ''; }} />
              <button disabled={uploading || !selectedBookId} onClick={() => sampleInputRef.current?.click()} className="flex items-center gap-2 px-5 py-3 bg-[#0b80ff] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-600 transition-all">
                <Upload size={18} />
                {uploading && bulk ? `${t('جاري الرفع', 'Uploading')} ${bulk.done + 1}/${bulk.total}` : (uploading ? t('جاري الرفع…', 'Uploading…') : t('رفع عينات صوتية', 'Upload audio samples'))}
              </button>
              {uploading && bulk && <p className="text-xs text-slate-400 mt-2 truncate">{bulk.name}</p>}
              {!selectedBookId && (<p className="text-xs text-amber-600 mt-2 flex items-center gap-1"><AlertCircle size={12} /> {t('يرجى اختيار الكتاب أولاً', 'Please select a book first')}</p>)}
            </div>

            {/* List */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                <SearchBar value={sampleSearch} onChange={setSampleSearch} placeholder={t('البحث في العينات...', 'Search samples…')} dir={dir} />
                <select value={sampleStatusFilter} onChange={(e) => setSampleStatusFilter(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700" dir={dir}>
                  <option value="">{t('كل الحالات', 'All statuses')}</option>
                  <option value="pending">{t('قيد المراجعة', 'Pending')}</option>
                  <option value="approved">{t('معتمدة', 'Approved')}</option>
                  <option value="refused">{t('مرفوضة', 'Refused')}</option>
                </select>
                <select value={sampleBookFilter} onChange={(e) => setSampleBookFilter(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 max-w-[220px]" dir={dir}>
                  <option value="">{t('كل الكتب', 'All books')}</option>
                  {sampleBookOptions.books.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                  {sampleBookOptions.hasUnlinked && <option value="__none__">{t('غير مرتبط بكتاب', 'Unlinked')}</option>}
                </select>
                <span className="text-xs text-slate-400 whitespace-nowrap">{filteredSamples.length} {t('عينة', 'samples')}</span>
              </div>
              {filteredSamples.length === 0 ? (
                <EmptyState icon={Music} title={t('لا توجد عينات', 'No samples')} subtitle={t('العينات التي ترفعها ستظهر هنا مع حالة المراجعة والكتاب المرتبط.', 'Samples you upload will appear here with their review status and linked book.')} />
              ) : (
                <div className="space-y-4">
                  {groupedSamples.map((g) => {
                    const collapsed = collapsedGroups.has(g.key);
                    return (
                      <div key={g.key} className="rounded-2xl border border-slate-100 overflow-hidden">
                        <button onClick={() => toggleGroup(g.key)} className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50/60 hover:bg-slate-50 transition-colors text-start">
                          <ChevronDown size={16} className={`text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                          <BookOpen size={15} className={g.key === '__none__' ? 'text-slate-400' : 'text-blue-500'} />
                          <h3 className={`text-sm font-bold flex-1 ${g.key === '__none__' ? 'text-slate-500' : 'text-slate-800'}`}>{g.bookName ?? t('غير مرتبط بكتاب', 'Unlinked')}</h3>
                          <span className="text-xs text-slate-400">{g.items.length}</span>
                        </button>
                        {!collapsed && (
                          <div className="grid gap-3 p-4">
                            {g.items.map((s) => (
                              <div key={s.id} className="p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all bg-white">
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><FileAudio size={18} className="text-amber-500" /></div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                                    <div className="flex items-center gap-3 mt-1">
                                      <span className="text-xs text-slate-400 flex items-center gap-1"><Hash size={12} /> {formatBytes(s.sizeBytes)}</span>
                                      <span className="text-xs text-slate-400 flex items-center gap-1"><Calendar size={12} /> {fd(s.createdAt)}</span>
                                    </div>
                                  </div>
                                  <StatusBadge status={s.status} isArabic={isArabic} />
                                </div>

                                <div className="mb-3">
                                  {playingSampleId === s.id && sampleUrls[s.id] ? (
                                    <AudioPlayer src={sampleUrls[s.id]} className="mb-1" />
                                  ) : (
                                    <button
                                      onClick={async () => {
                                        if (!sampleUrls[s.id]) { const url = await getDownloadUrl(s.objectKey); setSampleUrls((prev) => ({ ...prev, [s.id]: url })); }
                                        setPlayingSampleId(s.id);
                                      }}
                                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all"
                                    >
                                      <Music size={14} />
                                      {t('تشغيل العينة', 'Play sample')}
                                    </button>
                                  )}
                                </div>

                                {s.reviewNote && (
                                  <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                                    <p className="text-xs text-amber-800 leading-relaxed"><span className="font-semibold">{t('ملاحظة المراجعة:', 'Review note:')}</span> {s.reviewNote}</p>
                                    {s.reviewedBy && (<p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><Clock size={10} /> {s.reviewedBy} · {fd(s.reviewedAt ?? '')}</p>)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
