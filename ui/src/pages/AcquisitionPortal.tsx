import { useRef, useState, useEffect } from 'react';
import { CloudUpload, FileText, Upload, Send, Loader2, CheckCircle2, Pencil, Trash2, Globe } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';
import type { AcquisitionPortalResponse } from '@api';

const API_BASE_URL = typeof API_BASE === 'string' ? API_BASE : '';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
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
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ color: info.color, backgroundColor: `${info.color}18` }}
    >
      {isArabic ? info.label : info.en}
    </span>
  );
}

function LangToggle({ isArabic, toggleLocale }: { isArabic: boolean; toggleLocale: () => void }) {
  return (
    <button
      onClick={toggleLocale}
      className="flex items-center gap-1.5 bg-transparent border border-slate-200 rounded-lg py-[5px] px-3 text-[13px] text-[#718096] cursor-pointer"
    >
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
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
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              dir="ltr"
              className="w-full py-[11px] px-[14px] border border-slate-200 rounded-[10px] text-sm mb-3 box-border"
              onKeyDown={(e) => e.key === 'Enter' && requestLink()}
            />
            {error && <p className="text-[#e53e3e] text-[13px] mb-2">{error}</p>}
            <button
              onClick={requestLink}
              disabled={sending || !email.trim()}
              className="w-full p-3 bg-[#0b80ff] text-white border-none rounded-[10px] text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {t('إرسال رابط الدخول', 'Send sign-in link')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcquisitionPortal() {
  const { isArabic, toggleLocale } = useLocale();
  const { data, loading, error, refetch } = useApi<AcquisitionPortalResponse>('/api/acquisition-portal');
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; name: string } | null>(null);
  const pdfInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; bookAuthor: string; acqNotes: string }>({ name: '', bookAuthor: '', acqNotes: '' });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  function showNotice(msg: string) {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 4000);
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  async function bulkUpload(studioId: string, files: File[]) {
    const list = files.filter(Boolean);
    if (list.length === 0) return;
    setUploading(studioId);
    let ok = 0; const failedNames: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setBulk({ done: i, total: list.length, name: file.name });
      try {
        const { uploadUrl, objectKey } = await apiRequest<{ uploadUrl: string; objectKey: string }>(
          `/api/acquisition-portal/studios/${studioId}/production-file-upload-url`,
          { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } },
        );
        const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/pdf' } });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
        await apiRequest(`/api/acquisition-portal/studios/${studioId}/production-files/complete`, {
          method: 'POST',
          body: { objectKey, fileName: file.name, contentType: file.type || 'application/pdf', sizeBytes: file.size },
        });
        ok += 1;
      } catch {
        failedNames.push(file.name);
      }
    }
    setBulk(null);
    setUploading(null);
    if (failedNames.length) showNotice(`${t('تم رفع', 'Uploaded')} ${ok}/${list.length}. ${t('فشل:', 'Failed:')} ${failedNames.join(', ')}`);
    else showNotice(`${t('تم رفع', 'Uploaded')} ${ok} ${t('ملف وإشعار الاستوديو.', 'file(s) and notified the studio.')}`);
    refetch();
  }

  function startEdit(f: { id: string; name: string; bookAuthor?: string | null; acqNotes?: string | null }) {
    setEditing(f.id);
    setEditDraft({ name: f.name, bookAuthor: f.bookAuthor ?? '', acqNotes: f.acqNotes ?? '' });
  }

  async function saveMeta(studioId: string, fileId: string) {
    try {
      await apiRequest(`/api/acquisition-portal/studios/${studioId}/production-files/${fileId}/meta`, {
        method: 'PATCH',
        body: { name: editDraft.name.trim() || undefined, bookAuthor: editDraft.bookAuthor.trim() || null, acqNotes: editDraft.acqNotes.trim() || null },
      });
      showNotice(t('تم الحفظ.', 'Saved.'));
      setEditing(null);
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : t('فشل الحفظ', 'Save failed'));
    }
  }

  async function deleteFile(studioId: string, fileId: string) {
    try {
      await apiRequest(`/api/acquisition-portal/studios/${studioId}/production-files/${fileId}`, { method: 'DELETE' });
      showNotice(t('تم حذف الملف.', 'File deleted.'));
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

  return (
    <div className="min-h-screen bg-[#f5f7fa] font-sans">
      <header className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-[960px] mx-auto h-[60px] flex items-center gap-3">
          <CloudUpload className="w-[22px] h-[22px] text-[#0b80ff]" />
          <span className="font-bold text-base text-[#1a202c]">{t('بوابة الاقتناء — سماوي', 'Acquisition Portal — Samawy')}</span>
          <div className="ms-auto flex items-center gap-2">
            <LangToggle isArabic={isArabic} toggleLocale={toggleLocale} />
            <button
              onClick={() => fetch(`${API_BASE_URL}/api/acquisition-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
              className="bg-transparent border border-slate-200 rounded-lg py-[5px] px-3 text-[13px] text-[#718096] cursor-pointer"
            >
              {t('خروج', 'Sign out')}
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-[#1a202c] text-white py-3 px-6 rounded-xl text-sm z-[999] text-center max-w-[90vw]">
          {notice}
        </div>
      )}

      <main className="max-w-[960px] mx-auto py-7 px-5 grid gap-5">
        <h2 className="text-lg font-bold text-[#1a202c] m-0">{t('الاستوديوهات', 'Studios')} ({studios.length})</h2>

        {studios.length === 0 && (
          <div className="bg-white rounded-2xl p-8 text-center text-[#a0aec0] text-sm">{t('لا توجد استوديوهات نشطة.', 'No active studios.')}</div>
        )}

        {studios.map(({ studio, productionFiles, driveUploads }) => (
          <div key={studio.id} className="bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            {/* Studio header */}
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
                <input type="file" accept=".pdf,application/pdf" multiple className="hidden" ref={(el) => { pdfInputRef.current[studio.id] = el; }}
                  onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) bulkUpload(studio.id, fs); e.target.value = ''; }} />
                <button disabled={uploading === studio.id}
                  onClick={() => pdfInputRef.current[studio.id]?.click()}
                  className="flex items-center gap-2 py-2 px-4 bg-[#0b80ff] text-white border-none rounded-[10px] text-[13px] font-semibold cursor-pointer disabled:opacity-60"
                >
                  {uploading === studio.id ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Upload className="w-[15px] h-[15px]" />}
                  {uploading === studio.id ? (bulk ? `${bulk.done + 1}/${bulk.total}…` : t('جاري الرفع…', 'Uploading…')) : t('رفع ملفات إنتاج', 'Upload production files')}
                </button>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragTarget(studio.id); }}
              onDragLeave={() => setDragTarget((cur) => (cur === studio.id ? null : cur))}
              onDrop={(e) => { e.preventDefault(); setDragTarget(null); const fs = Array.from(e.dataTransfer.files); if (fs.length && uploading !== studio.id) bulkUpload(studio.id, fs); }}
              className={`mb-5 rounded-xl border-2 border-dashed px-4 py-3 text-center text-xs transition-colors ${dragTarget === studio.id ? 'border-[#0b80ff] bg-[rgba(11,128,255,0.05)] text-[#0b80ff]' : 'border-slate-200 text-[#a0aec0]'}`}
            >
              {t('اسحب ملفات PDF هنا للرفع', 'Drag PDF files here to upload')}
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {/* Production files */}
              <div>
                <p className="text-[13px] font-semibold text-[#4a5568] mb-2.5">{t('ملفات الإنتاج', 'Production files')} ({productionFiles.length})</p>
                {productionFiles.length === 0 ? (
                  <p className="text-[13px] text-[#a0aec0]">{t('لا توجد ملفات.', 'No files yet.')}</p>
                ) : (
                  <div className="grid gap-2">
                    {productionFiles.map((f) => (
                      <div key={f.id} className="py-2 px-3 border border-slate-200 rounded-[10px]">
                        {editing === f.id ? (
                          <div className="grid gap-2">
                            <input className="w-full text-[13px] border border-slate-200 rounded-lg px-2 py-1.5" value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} placeholder={t('عنوان الكتاب', 'Book title')} />
                            <input className="w-full text-[13px] border border-slate-200 rounded-lg px-2 py-1.5" value={editDraft.bookAuthor} onChange={(e) => setEditDraft((d) => ({ ...d, bookAuthor: e.target.value }))} placeholder={t('المؤلف', 'Author')} />
                            <textarea className="w-full text-[13px] border border-slate-200 rounded-lg px-2 py-1.5 resize-y" rows={2} value={editDraft.acqNotes} onChange={(e) => setEditDraft((d) => ({ ...d, acqNotes: e.target.value }))} placeholder={t('ملاحظات', 'Notes')} />
                            <div className="flex items-center gap-2">
                              <button className="py-1 px-3 bg-[#0b80ff] text-white rounded-lg text-xs font-semibold" onClick={() => saveMeta(studio.id, f.id)}>{t('حفظ', 'Save')}</button>
                              <button className="text-xs text-[#718096]" onClick={() => setEditing(null)}>{t('إلغاء', 'Cancel')}</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2.5">
                            <FileText className="w-4 h-4 text-[#e53e3e] shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] truncate font-medium">{f.name}</p>
                              {f.bookAuthor && <p className="text-[11px] text-[#718096] truncate">{t('المؤلف:', 'Author:')} {f.bookAuthor}</p>}
                              {f.acqNotes && <p className="text-[11px] text-[#a0aec0] italic mt-0.5">{f.acqNotes}</p>}
                              <p className="text-[11px] text-[#a0aec0] mt-0.5">{formatBytes(f.sizeBytes)}{f.audiobookId ? ` · ${t('في الإنتاج', 'in production')}` : ''}</p>
                            </div>
                            {!f.audiobookId && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button className="text-[#718096] hover:text-[#0b80ff] p-1" onClick={() => startEdit(f)}><Pencil className="w-3.5 h-3.5" /></button>
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
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Books uploaded */}
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
