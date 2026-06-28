import { useRef, useState, useEffect } from 'react';
import { CloudUpload, FileText, Send, Loader2, CheckCircle2, Pencil, Trash2, Globe, Plus, X, Search, Upload } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';
import type { AcquisitionPortalResponse, AcqBookMetadata } from '@api';

const API_BASE_URL = typeof API_BASE === 'string' ? API_BASE : '';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

type Seller = { id: number; name: string };
type FormState = {
  sellerId: number | null; sellerName: string | null;
  title: string; subtitle: string; author: string; narrator: string; isbn: string;
  genre: string; blurb: string; pubYear: string; sellingType: '' | 'subscription' | 'a_la_carte'; price: string;
};
const emptyForm: FormState = { sellerId: null, sellerName: null, title: '', subtitle: '', author: '', narrator: '', isbn: '', genre: '', blurb: '', pubYear: '', sellingType: '', price: '' };

function metadataToForm(m: AcqBookMetadata | null | undefined, fallbackTitle: string): FormState {
  if (!m) return { ...emptyForm, title: fallbackTitle };
  return {
    sellerId: m.sellerId ?? null, sellerName: m.sellerName ?? null,
    title: m.title ?? fallbackTitle, subtitle: m.subtitle ?? '', author: m.author ?? '', narrator: m.narrator ?? '',
    isbn: m.isbn ?? '', genre: m.genre ?? '', blurb: m.blurb ?? '', pubYear: m.pubYear ?? '',
    sellingType: (m.sellingType ?? '') as FormState['sellingType'], price: m.price != null ? String(m.price) : '',
  };
}

function formToMetadata(f: FormState): AcqBookMetadata {
  return {
    sellerId: f.sellerId, sellerName: f.sellerName,
    title: f.title.trim(), subtitle: f.subtitle.trim() || null, author: f.author.trim() || null, narrator: f.narrator.trim() || null,
    isbn: f.isbn.trim() || null, genre: f.genre.trim() || null, blurb: f.blurb.trim() || null, pubYear: f.pubYear.trim() || null,
    sellingType: f.sellingType || null, price: f.price.trim() === '' ? null : Number(f.price),
  };
}

function DriveUploadStatusBadge({ status, isArabic }: { status: string; isArabic: boolean }) {
  const map: Record<string, { label: string; en: string; color: string }> = {
    pending: { label: 'انتظار', en: 'Pending', color: '#d97706' },
    uploading: { label: 'جاري', en: 'Uploading', color: '#2563eb' },
    completed: { label: 'مكتمل', en: 'Completed', color: '#16a34a' },
    pushed: { label: 'في الإنتاج', en: 'In production', color: '#7c3aed' },
    failed: { label: 'فشل', en: 'Failed', color: '#dc2626' },
  };
  const info = map[status] ?? { label: status, en: status, color: '#718096' };
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: info.color, backgroundColor: `${info.color}18` }}>
      {isArabic ? info.label : info.en}
    </span>
  );
}

function ProdStatusBadge({ status, isArabic }: { status: string; isArabic: boolean }) {
  const map: Record<string, { label: string; en: string; color: string }> = {
    backlog: { label: 'قائمة الانتظار', en: 'Backlog', color: '#718096' },
    in_production: { label: 'قيد الإنتاج', en: 'In Production', color: '#2563eb' },
    delivered: { label: 'تم التسليم', en: 'Delivered', color: '#16a34a' },
  };
  const info = map[status] ?? { label: status, en: status, color: '#718096' };
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: info.color, backgroundColor: `${info.color}18` }}>
      {isArabic ? info.label : info.en}
    </span>
  );
}

function LangToggle({ isArabic, toggleLocale }: { isArabic: boolean; toggleLocale: () => void }) {
  return (
    <button onClick={toggleLocale} className="flex items-center gap-1.5 bg-transparent border border-slate-200 rounded-lg py-[5px] px-3 text-[13px] text-[#718096] cursor-pointer">
      <Globe className="w-3.5 h-3.5" />
      {isArabic ? 'EN' : 'ع'}
    </button>
  );
}

function LoginGate() {
  const { isArabic, toggleLocale } = useLocale();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  async function requestLink() {
    if (!email.trim()) return;
    setSending(true); setError('');
    try {
      await fetch(`${API_BASE_URL}/api/acquisition-auth/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }), credentials: 'include',
      });
      setSent(true);
    } catch {
      setError(t('حدث خطأ. يرجى المحاولة مرة أخرى.', 'Something went wrong. Please try again.'));
    } finally { setSending(false); }
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex items-center justify-center p-8 font-sans">
      <div className="bg-white rounded-[20px] max-w-[420px] w-full p-12 shadow-[0_8px_32px_rgba(0,0,0,0.08)] text-center relative">
        <div className="absolute top-4 ltr:right-4 rtl:left-4"><LangToggle isArabic={isArabic} toggleLocale={toggleLocale} /></div>
        <div className="w-14 h-14 rounded-[14px] bg-[rgba(11,128,255,0.1)] flex items-center justify-center mx-auto mb-5">
          <CloudUpload className="w-7 h-7 text-[#0b80ff]" />
        </div>
        <h1 className="text-xl font-bold text-[#1a202c] mb-2">{t('بوابة الاقتناء', 'Acquisition Portal')}</h1>
        {sent ? (
          <>
            <div className="w-12 h-12 rounded-full bg-[#f0fdf4] flex items-center justify-center mx-auto my-5">
              <CheckCircle2 className="w-6 h-6 text-[#16a34a]" />
            </div>
            <p className="text-[#555] leading-relaxed">{t('تم إرسال رابط الدخول. تحقق من بريدك.', 'Sign-in link sent. Check your inbox.')}</p>
          </>
        ) : (
          <>
            <p className="text-[#718096] mb-6 leading-relaxed text-sm">{t('أدخل بريدك الإلكتروني لتلقّي رابط الدخول.', 'Enter your email to receive a sign-in link.')}</p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" dir="ltr"
              className="w-full py-[11px] px-[14px] border border-slate-200 rounded-[10px] text-sm mb-3 box-border"
              onKeyDown={(e) => e.key === 'Enter' && requestLink()} />
            {error && <p className="text-[#e53e3e] text-[13px] mb-2">{error}</p>}
            <button onClick={requestLink} disabled={sending || !email.trim()}
              className="w-full p-3 bg-[#0b80ff] text-white border-none rounded-[10px] text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {t('إرسال رابط الدخول', 'Send sign-in link')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Rich metadata editor (mirrors the operator's delivery-push form) ──────────
function MetadataEditor({ mode, studioId, fileId, initial, genres, onClose, onDone, t }: {
  mode: 'create' | 'edit'; studioId: string; fileId?: string; initial: FormState; genres: { id?: string | number; name: string }[];
  onClose: () => void; onDone: (msg: string) => void; t: (ar: string, en: string) => string;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [sellerQuery, setSellerQuery] = useState('');
  const [sellerResults, setSellerResults] = useState<Seller[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function searchSellers() {
    if (!sellerQuery.trim()) return;
    setSearching(true);
    try {
      const { sellers } = await apiRequest<{ sellers: Seller[] }>(`/api/acquisition-portal/sellers?q=${encodeURIComponent(sellerQuery.trim())}`);
      setSellerResults(sellers ?? []);
    } catch { setSellerResults([]); }
    finally { setSearching(false); }
  }

  function xhrPut(url: string, f: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', f.type || 'application/pdf');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(f);
    });
  }

  async function submit() {
    if (!form.title.trim()) { setError(t('العنوان مطلوب', 'Title is required')); return; }
    if (mode === 'create' && !file) { setError(t('يرجى اختيار ملف PDF', 'Please choose a PDF file')); return; }
    setSaving(true); setError('');
    try {
      const metadata = formToMetadata(form);
      if (mode === 'create' && file) {
        const { uploadUrl, objectKey } = await apiRequest<{ uploadUrl: string; objectKey: string }>(
          `/api/acquisition-portal/studios/${studioId}/production-file-upload-url`,
          { method: 'POST', body: { fileName: file.name, contentType: file.type || 'application/pdf', sizeBytes: file.size } },
        );
        await xhrPut(uploadUrl, file);
        await apiRequest(`/api/acquisition-portal/studios/${studioId}/production-files/complete`, {
          method: 'POST', timeoutMs: 60_000,
          body: { objectKey, fileName: file.name, contentType: file.type || 'application/pdf', sizeBytes: file.size, metadata },
        });
        onDone(t('تمت إضافة الكتاب وإشعار الاستوديو.', 'Book added and studio notified.'));
      } else {
        await apiRequest(`/api/acquisition-portal/studios/${studioId}/production-files/${fileId}/meta`, { method: 'PATCH', body: { metadata } });
        onDone(t('تم الحفظ.', 'Saved.'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('فشل الحفظ', 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[640px] my-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-[#1a202c]">{mode === 'create' ? t('إضافة كتاب جديد', 'Add a new book') : t('تعديل بيانات الكتاب', 'Edit book metadata')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* File (create only) */}
          {mode === 'create' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('ملف الكتاب (PDF)', 'Book file (PDF)')} *</label>
              <input type="file" accept=".pdf,application/pdf" ref={fileRef} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-[#0b80ff] hover:text-[#0b80ff] transition-colors w-full">
                <Upload className="w-4 h-4" />{file ? file.name : t('اختر ملف PDF', 'Choose a PDF file')}
              </button>
            </div>
          )}

          {/* Publisher search */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('الناشر', 'Publisher')}</label>
            {form.sellerId ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 w-fit">
                <span className="font-semibold">{form.sellerName} <span className="opacity-70">#{form.sellerId}</span></span>
                <button onClick={() => { set('sellerId', null); set('sellerName', null); }} className="text-emerald-700"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input className="w-full ltr:pl-9 rtl:pr-9 px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder={t('ابحث عن الناشر…', 'Search publisher…')} value={sellerQuery} onChange={(e) => setSellerQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchSellers()} />
                  </div>
                  <button onClick={searchSellers} disabled={searching} className="px-3 py-2 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-50">{searching ? '…' : t('بحث', 'Search')}</button>
                </div>
                {sellerResults.length > 0 && (
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 max-h-40 overflow-y-auto">
                    {sellerResults.map((s) => (
                      <button key={s.id} className="w-full text-start px-3 py-1.5 text-xs hover:bg-slate-50" onClick={() => { set('sellerId', s.id); set('sellerName', s.name); setSellerResults([]); setSellerQuery(''); }}>{s.name} <span className="text-slate-400">#{s.id}</span></button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={`${t('العنوان', 'Title')} *`} value={form.title} onChange={(v) => set('title', v)} />
            <Field label={t('العنوان الفرعي', 'Subtitle')} value={form.subtitle} onChange={(v) => set('subtitle', v)} />
            <Field label={t('المؤلف', 'Author')} value={form.author} onChange={(v) => set('author', v)} />
            <Field label={t('الراوي', 'Narrator')} value={form.narrator} onChange={(v) => set('narrator', v)} />
            <Field label="ISBN" value={form.isbn} onChange={(v) => set('isbn', v)} mono />
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('النوع', 'Genre')}</label>
              {genres.length ? (
                <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.genre} onChange={(e) => set('genre', e.target.value)}>
                  <option value="">{t('— اختر —', '— Select —')}</option>
                  {genres.map((g) => <option key={`${g.id ?? g.name}`} value={g.name}>{g.name}</option>)}
                </select>
              ) : (
                <input className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.genre} onChange={(e) => set('genre', e.target.value)} />
              )}
            </div>
            <Field label={t('سنة النشر', 'Pub year')} value={form.pubYear} onChange={(v) => set('pubYear', v)} />
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('نوع البيع', 'Selling type')}</label>
              <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.sellingType} onChange={(e) => set('sellingType', e.target.value as FormState['sellingType'])}>
                <option value="">{t('— اختر —', '— Select —')}</option>
                <option value="subscription">{t('اشتراك', 'Subscription')}</option>
                <option value="a_la_carte">{t('شراء منفرد', 'A la carte')}</option>
              </select>
            </div>
            <Field label={t('السعر', 'Price')} value={form.price} onChange={(v) => set('price', v)} type="number" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('نبذة', 'Blurb')}</label>
            <textarea className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-y" rows={3} value={form.blurb} onChange={(e) => set('blurb', e.target.value)} />
          </div>

          {error && <p className="text-[#e53e3e] text-xs">{error}</p>}
          {saving && progress > 0 && progress < 100 && (
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#0b80ff]" style={{ width: `${progress}%` }} /></div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-[#0b80ff] text-white rounded-lg text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {mode === 'create' ? t('رفع وإضافة', 'Upload & add') : t('حفظ', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', mono = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <input type={type} step={type === 'number' ? '0.01' : undefined} min={type === 'number' ? '0' : undefined} className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm ${mono ? 'font-mono' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function AcquisitionPortal() {
  const { isArabic, toggleLocale } = useLocale();
  const { data, loading, error, refetch } = useApi<AcquisitionPortalResponse>('/api/acquisition-portal');
  const { data: genresData } = useApi<{ genres: { id?: string | number; name: string }[] }>('/api/acquisition-portal/genres');
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; studioId: string; fileId?: string; initial: FormState } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  function showNotice(msg: string) {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 4000);
  }
  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  async function deleteFile(studioId: string, fileId: string) {
    try {
      await apiRequest(`/api/acquisition-portal/studios/${studioId}/production-files/${fileId}`, { method: 'DELETE' });
      showNotice(t('تم حذف الكتاب.', 'Book deleted.'));
      setConfirmDelete(null);
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : t('فشل الحذف', 'Delete failed'));
    }
  }

  if (error?.includes('401') || error?.includes('Unauthorized')) return <LoginGate />;
  if (loading) return <LoginGate />;
  if (!data) return <LoginGate />;

  const studios = data.studios;
  const genres = genresData?.genres ?? [];

  return (
    <div className="min-h-screen bg-[#f5f7fa] font-sans">
      <header className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-[960px] mx-auto h-[60px] flex items-center gap-3">
          <CloudUpload className="w-[22px] h-[22px] text-[#0b80ff]" />
          <span className="font-bold text-base text-[#1a202c]">{t('بوابة الاقتناء — سماوي', 'Acquisition Portal — Samawy')}</span>
          <div className="ms-auto flex items-center gap-2">
            <LangToggle isArabic={isArabic} toggleLocale={toggleLocale} />
            <button onClick={() => fetch(`${API_BASE_URL}/api/acquisition-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
              className="bg-transparent border border-slate-200 rounded-lg py-[5px] px-3 text-[13px] text-[#718096] cursor-pointer">
              {t('خروج', 'Sign out')}
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-[#1a202c] text-white py-3 px-6 rounded-xl text-sm z-[999] text-center max-w-[90vw]">{notice}</div>
      )}

      {editor && (
        <MetadataEditor
          mode={editor.mode} studioId={editor.studioId} fileId={editor.fileId} initial={editor.initial} genres={genres}
          onClose={() => setEditor(null)} onDone={(msg) => { setEditor(null); showNotice(msg); refetch(); }}
          t={t}
        />
      )}

      <main className="max-w-[960px] mx-auto py-7 px-5 grid gap-5">
        <h2 className="text-lg font-bold text-[#1a202c] m-0">{t('الاستوديوهات', 'Studios')} ({studios.length})</h2>

        {studios.length === 0 && (
          <div className="bg-white rounded-2xl p-8 text-center text-[#a0aec0] text-sm">{t('لا توجد استوديوهات نشطة.', 'No active studios.')}</div>
        )}

        {studios.map(({ studio, productionFiles, driveUploads }) => (
          <div key={studio.id} className="bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-[14px] mb-5">
              {studio.logoObjectKey ? (
                <img src={`${API_BASE_URL}/api/files/${studio.logoObjectKey}?preview=1`} alt="" className="w-11 h-11 rounded-xl object-cover border border-slate-200" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-[#edf2f7] flex items-center justify-center text-[#a0aec0] text-lg">🏢</div>
              )}
              <div>
                <h3 className="m-0 text-base font-bold text-[#1a202c]">{studio.name}</h3>
                <p className="m-0 text-xs text-[#718096]">{studio.contactEmail}</p>
              </div>
              <div className="ms-auto">
                <button onClick={() => setEditor({ mode: 'create', studioId: studio.id, initial: { ...emptyForm } })}
                  className="flex items-center gap-2 py-2 px-4 bg-[#0b80ff] text-white border-none rounded-[10px] text-[13px] font-semibold cursor-pointer">
                  <Plus className="w-[15px] h-[15px]" />{t('إضافة كتاب', 'Add book')}
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {/* Production files */}
              <div>
                <p className="text-[13px] font-semibold text-[#4a5568] mb-2.5">{t('الكتب', 'Books')} ({productionFiles.length})</p>
                {productionFiles.length === 0 ? (
                  <p className="text-[13px] text-[#a0aec0]">{t('لا توجد كتب بعد.', 'No books yet.')}</p>
                ) : (
                  <div className="grid gap-2">
                    {productionFiles.map((f) => (
                      <div key={f.id} className="py-2 px-3 border border-slate-200 rounded-[10px]">
                        <div className="flex items-start gap-2.5">
                          <FileText className="w-4 h-4 text-[#e53e3e] shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[13px] truncate font-medium">{f.name}</p>
                              <ProdStatusBadge status={f.productionStatus ?? 'backlog'} isArabic={isArabic} />
                            </div>
                            {f.acqMetadata?.author && <p className="text-[11px] text-[#718096] truncate">{t('المؤلف:', 'Author:')} {f.acqMetadata.author}</p>}
                            {f.acqMetadata?.sellerName && <p className="text-[11px] text-[#718096] truncate">{t('الناشر:', 'Publisher:')} {f.acqMetadata.sellerName}</p>}
                            <p className="text-[11px] text-[#a0aec0] mt-0.5">{formatBytes(f.sizeBytes)}{f.audiobookId ? ` · ${t('في الإنتاج', 'in production')}` : ''}</p>
                          </div>
                          {!f.audiobookId && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button className="text-[#718096] hover:text-[#0b80ff] p-1" onClick={() => setEditor({ mode: 'edit', studioId: studio.id, fileId: f.id, initial: metadataToForm(f.acqMetadata, f.name) })}><Pencil className="w-3.5 h-3.5" /></button>
                              {confirmDelete === f.id ? (
                                <span className="flex items-center gap-1">
                                  <button className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteFile(studio.id, f.id)}>{t('تأكيد', 'Confirm')}</button>
                                  <button className="text-[10px] text-slate-500" onClick={() => setConfirmDelete(null)}>{t('إلغاء', 'Cancel')}</button>
                                </span>
                              ) : (
                                <button className="text-red-400 hover:text-red-600 p-1" onClick={() => setConfirmDelete(f.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Deliveries */}
              <div>
                <p className="text-[13px] font-semibold text-[#4a5568] mb-2.5">{t('الكتب المرفوعة', 'Books uploaded')} ({driveUploads.length})</p>
                {driveUploads.length === 0 ? (
                  <p className="text-[13px] text-[#a0aec0]">{t('لم يرفع الاستوديو أي كتب بعد.', 'The studio has not uploaded any books yet.')}</p>
                ) : (
                  <div className="grid gap-2">
                    {driveUploads.map((d) => (
                      <div key={d.id} className="flex items-center gap-2.5 py-2 px-3 border border-slate-200 rounded-[10px]">
                        <span className="flex-1 text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">{d.name}</span>
                        <DriveUploadStatusBadge status={d.status} isArabic={isArabic} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
