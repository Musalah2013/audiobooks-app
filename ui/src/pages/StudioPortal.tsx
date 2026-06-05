import { useRef, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Download, Upload, CheckCircle2, FileText, Music, CloudUpload, Send, Loader2,
  Search, BookOpen, Package, Inbox, LogOut, ChevronLeft,
  FileAudio, Hash, Calendar, AlertCircle, Clock
} from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import type { StudioPortalResponse } from '@api';

const API_BASE_URL = typeof API_BASE === 'string' ? API_BASE : '';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    pending:   { label: 'قيد الانتظار', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    approved:  { label: 'موافقة',       bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    refused:   { label: 'مرفوضة',       bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
    uploading: { label: 'جاري الرفع',   bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    completed: { label: 'مكتمل',        bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    failed:    { label: 'فشل',          bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  };
  const info = map[status] ?? { label: status, bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${info.bg} ${info.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active
          ? 'bg-[#0b80ff] text-white shadow-md shadow-blue-200'
          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Icon size={16} />
      {label}
      {count !== undefined && count > 0 && (
        <span className={`text-xs px-1.5 py-0.5 rounded-md ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pr-9 pl-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0b80ff]/20 focus:border-[#0b80ff] transition-all"
        dir="rtl"
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

function LoginGate({ slug }: { slug: string }) {
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
      setError('حدث خطأ. يرجى المحاولة مرة أخرى.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-3xl max-w-md w-full p-12 shadow-xl shadow-slate-200/50 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
          <CloudUpload size={28} className="text-[#0b80ff]" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">بوابة سماوي للاستوديوهات</h1>
        {sent ? (
          <div className="mt-6">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <p className="text-slate-600 leading-relaxed">تم إرسال رابط الدخول إلى بريدك الإلكتروني. تحقق من بريدك وانقر على الرابط للدخول.</p>
          </div>
        ) : (
          <>
            <p className="text-slate-400 mb-7 text-sm leading-relaxed">أدخل بريدك الإلكتروني المسجّل لتلقّي رابط الدخول.</p>
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
              {sending ? 'جاري الإرسال…' : 'إرسال رابط الدخول'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StudioPortal() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading, error, refetch } = useApi<StudioPortalResponse>(`/api/studio-portal/${slug}`);
  const [activeTab, setActiveTab] = useState<'overview' | 'assets' | 'production' | 'drive' | 'samples'>('overview');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sampleSearch, setSampleSearch] = useState('');
  const [, setPlayingSample] = useState<string | null>(null);

  const driveInputRef = useRef<HTMLInputElement>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);

  function showNotice(msg: string) { setNotice(msg); setTimeout(() => setNotice(''), 5000); }

  async function getDownloadUrl(objectKey: string): Promise<string> {
    const { url } = await apiRequest<{ url: string }>(`/api/studio-portal/${slug}/asset-download-url`, { method: 'POST', body: { objectKey } });
    return url;
  }

  async function getPdfDownloadUrl(objectKey: string): Promise<string> {
    const { url } = await apiRequest<{ url: string }>(`/api/studio-portal/${slug}/production-file-download-url`, { method: 'POST', body: { objectKey } });
    return url;
  }

  async function handleDriveUpload(file: File) {
    setUploading(true); setUploadProgress(0);
    try {
      const { uploadUrl, uploadId } = await apiRequest<{ uploadUrl: string; uploadId: string }>(`/api/studio-portal/${slug}/drive-upload-url`, {
        method: 'POST',
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(file);
      });
      await apiRequest(`/api/studio-portal/${slug}/drive-uploads/${uploadId}/complete`, { method: 'POST' });
      showNotice('تم رفع الملف بنجاح وسيتم مزامنته مع Google Drive.');
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'فشل الرفع');
    } finally {
      setUploading(false); setUploadProgress(0);
    }
  }

  async function handleSampleUpload(file: File) {
    setUploading(true);
    try {
      const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/api/studio-portal/${slug}/sample-upload-url`, {
        method: 'POST',
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      showNotice('تم رفع العينة بنجاح وسيتم إشعار الفريق.');
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'فشل رفع العينة');
    } finally {
      setUploading(false);
    }
  }

  // Unauthenticated
  if (error?.includes('401') || error?.includes('Unauthorized')) return <LoginGate slug={slug ?? ''} />;
  if (loading) return <LoginGate slug={slug ?? ''} />;
  if (!data) return <LoginGate slug={slug ?? ''} />;

  const { studio, assets, productionFiles, samples, driveUploads } = data;

  const filteredAssets = useMemo(() => {
    if (!searchQuery) return assets;
    return assets.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [assets, searchQuery]);

  const filteredProduction = useMemo(() => {
    if (!searchQuery) return productionFiles;
    return productionFiles.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [productionFiles, searchQuery]);

  const filteredSamples = useMemo(() => {
    if (!sampleSearch) return samples;
    return samples.filter(s => s.name.toLowerCase().includes(sampleSearch.toLowerCase()));
  }, [samples, sampleSearch]);

  const stats = [
    { label: 'الملفات المرجعية', value: assets.length, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'ملفات الإنتاج', value: productionFiles.length, icon: FileText, color: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'الرفوعات', value: driveUploads.length, icon: CloudUpload, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'العينات', value: samples.length, icon: Music, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  return (
    <div className="min-h-screen bg-[#f5f7fa]" dir="rtl">
      {/* Toast */}
      {notice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-2xl text-sm z-50 shadow-xl shadow-slate-900/20 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-400" />
          {notice}
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
          {studio.logoObjectKey ? (
            <img
              src={`${API_BASE_URL}/api/files/${studio.logoObjectKey}?preview=1`}
              alt={studio.name}
              className="h-10 w-10 object-cover rounded-xl border border-slate-100"
            />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <BookOpen size={20} className="text-[#0b80ff]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-900 truncate">{studio.name}</h1>
            <p className="text-xs text-slate-400">بوابة سماوي للاستوديوهات</p>
          </div>
          <button
            onClick={() => fetch(`${API_BASE_URL}/api/studio-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-all"
          >
            <LogOut size={14} />
            خروج
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex gap-2 overflow-x-auto">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={Inbox} label="نظرة عامة" />
          <TabButton active={activeTab === 'assets'} onClick={() => setActiveTab('assets')} icon={Package} label="المرجعيات" count={assets.length} />
          <TabButton active={activeTab === 'production'} onClick={() => setActiveTab('production')} icon={FileText} label="الإنتاج" count={productionFiles.length} />
          <TabButton active={activeTab === 'drive'} onClick={() => setActiveTab('drive')} icon={CloudUpload} label="الرفوعات" count={driveUploads.length} />
          <TabButton active={activeTab === 'samples'} onClick={() => setActiveTab('samples')} icon={Music} label="العينات" count={samples.length} />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* ─── Overview Tab ─── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    if (s.label === 'الملفات المرجعية') setActiveTab('assets');
                    if (s.label === 'ملفات الإنتاج') setActiveTab('production');
                    if (s.label === 'الرفوعات') setActiveTab('drive');
                    if (s.label === 'العينات') setActiveTab('samples');
                  }}
                  className="bg-white rounded-2xl p-5 border border-slate-100 hover:border-slate-200 hover:shadow-md transition-all text-right"
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
              <h2 className="text-base font-bold text-slate-900 mb-4">آخر النشاطات</h2>
              {driveUploads.length === 0 && samples.length === 0 ? (
                <EmptyState icon={Inbox} title="لا يوجد نشاط حالياً" subtitle="ستظهر هنا آخر الملفات المرفوعة والعينات." />
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
                          <p className="text-xs text-slate-400">{formatDate(item.createdAt)}</p>
                        </div>
                        {'status' in item && <StatusBadge status={(item as any).status} />}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Assets Tab ─── */}
        {activeTab === 'assets' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-5">
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="البحث في الملفات المرجعية..." />
              <span className="text-xs text-slate-400 whitespace-nowrap">{filteredAssets.length} ملف</span>
            </div>
            {filteredAssets.length === 0 ? (
              <EmptyState icon={Package} title="لا توجد ملفات مرجعية" subtitle="ملفات رفعها فريق سماوي لمرجعيتك ستظهر هنا." />
            ) : (
              <div className="grid gap-3">
                {filteredAssets.map((a) => (
                  <div key={a.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all bg-white">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{a.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Hash size={12} /> {formatBytes(a.sizeBytes)}
                        </span>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Calendar size={12} /> {formatDate(a.createdAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={async () => { const url = await getDownloadUrl(a.objectKey); window.open(url, '_blank'); }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-all"
                    >
                      <Download size={14} /> تنزيل
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Production Tab ─── */}
        {activeTab === 'production' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-5">
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="البحث في ملفات الإنتاج..." />
              <span className="text-xs text-slate-400 whitespace-nowrap">{filteredProduction.length} ملف</span>
            </div>
            {filteredProduction.length === 0 ? (
              <EmptyState icon={FileText} title="لا توجد ملفات إنتاج" subtitle="ملفات PDF أرسلها إليك فريق سماوي لمتابعة الإنتاج." />
            ) : (
              <div className="grid gap-3">
                {filteredProduction.map((f) => (
                  <div key={f.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all bg-white">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} className="text-rose-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{f.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Hash size={12} /> {formatBytes(f.sizeBytes)}
                        </span>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Calendar size={12} /> {formatDate(f.createdAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={async () => { const url = await getPdfDownloadUrl(f.objectKey); window.open(url, '_blank'); }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-all"
                    >
                      <Download size={14} /> تنزيل
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Drive Uploads Tab ─── */}
        {activeTab === 'drive' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-1">رفع الكتب إلى Google Drive</h2>
              <p className="text-xs text-slate-400 mb-4">ارفع ملفات الكتاب الصوتي النهائية لتُحفظ في Google Drive.</p>
              <input type="file" ref={driveInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDriveUpload(f); }} />
              <div className="flex items-center gap-4">
                <button
                  disabled={uploading}
                  onClick={() => driveInputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-3 bg-[#0b80ff] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-600 transition-all"
                >
                  <CloudUpload size={18} />
                  {uploading ? 'جاري الرفع…' : 'اختيار ملف'}
                </button>
                {uploading && (
                  <div className="flex-1 max-w-xs">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0b80ff] rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{uploadProgress}%</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-4">الملفات المرفوعة</h2>
              {driveUploads.length === 0 ? (
                <EmptyState icon={CloudUpload} title="لم يتم رفع أي ملفات" subtitle="الملفات التي ترفعها ستظهر هنا مع حالة المزامنة." />
              ) : (
                <div className="grid gap-3">
                  {driveUploads.map((d) => (
                    <div key={d.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                        <CloudUpload size={18} className="text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{d.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(d.createdAt)}</p>
                      </div>
                      <StatusBadge status={d.status} />
                      {d.driveFileId && (
                        <a
                          href={`https://drive.google.com/file/d/${d.driveFileId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#0b80ff] hover:underline flex items-center gap-1"
                        >
                          Drive <ChevronLeft size={12} />
                        </a>
                      )}
                      {d.error && (
                        <span className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle size={12} /> {d.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Samples Tab ─── */}
        {activeTab === 'samples' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-base font-bold text-slate-900 mb-1">العينات الصوتية</h2>
              <p className="text-xs text-slate-400 mb-4">ارفع عينات صوتية لمراجعتها وإبداء الموافقة من فريق سماوي.</p>
              <input type="file" ref={sampleInputRef} className="hidden" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSampleUpload(f); }} />
              <button
                disabled={uploading}
                onClick={() => sampleInputRef.current?.click()}
                className="flex items-center gap-2 px-5 py-3 bg-[#0b80ff] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-600 transition-all"
              >
                <Upload size={18} />
                {uploading ? 'جاري الرفع…' : 'رفع عينة صوتية'}
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <div className="flex items-center gap-3 mb-5">
                <SearchBar value={sampleSearch} onChange={setSampleSearch} placeholder="البحث في العينات..." />
                <span className="text-xs text-slate-400 whitespace-nowrap">{filteredSamples.length} عينة</span>
              </div>
              {filteredSamples.length === 0 ? (
                <EmptyState icon={Music} title="لم تُرفع أي عينات" subtitle="العينات التي ترفعها ستظهر هنا مع حالة المراجعة." />
              ) : (
                <div className="grid gap-4">
                  {filteredSamples.map((s) => (
                    <div key={s.id} className="p-5 rounded-2xl border border-slate-100 hover:border-slate-200 transition-all bg-white">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                          <FileAudio size={18} className="text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Hash size={12} /> {formatBytes(s.sizeBytes)}
                            </span>
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Calendar size={12} /> {formatDate(s.createdAt)}
                            </span>
                          </div>
                        </div>
                        <StatusBadge status={s.status} />
                      </div>

                      <div className="bg-slate-50 rounded-xl p-3">
                        <audio
                          controls
                          className="w-full h-10"
                          src={`${API_BASE_URL}/api/files/${s.objectKey}?preview=1`}
                          onPlay={() => setPlayingSample(s.id)}
                          onPause={() => setPlayingSample(null)}
                        />
                      </div>

                      {s.reviewNote && (
                        <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                          <p className="text-xs text-amber-800 leading-relaxed">
                            <span className="font-semibold">ملاحظة المراجعة:</span> {s.reviewNote}
                          </p>
                          {s.reviewedBy && (
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                              <Clock size={10} /> {s.reviewedBy} · {formatDate(s.reviewedAt ?? '')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
