import { useRef, useState, useEffect } from 'react';
import { CloudUpload, FileText, Upload, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import type { AcquisitionPortalResponse } from '@api';

const API_BASE_URL = typeof API_BASE === 'string' ? API_BASE : '';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function DriveUploadStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: 'انتظار', color: '#d97706' },
    uploading: { label: 'جاري', color: '#2563eb' },
    completed: { label: 'مكتمل', color: '#16a34a' },
    failed: { label: 'فشل', color: '#dc2626' },
  };
  const info = map[status] ?? { label: status, color: '#718096' };
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ color: info.color, backgroundColor: `${info.color}18` }}
    >
      {info.label}
    </span>
  );
}

function LoginGate() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

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
      setError('حدث خطأ. يرجى المحاولة مرة أخرى.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex items-center justify-center p-8 font-sans" dir="rtl">
      <div className="bg-white rounded-[20px] max-w-[420px] w-full p-12 shadow-[0_8px_32px_rgba(0,0,0,0.08)] text-center">
        <div className="w-14 h-14 rounded-[14px] bg-[rgba(11,128,255,0.1)] flex items-center justify-center mx-auto mb-5">
          <CloudUpload className="w-7 h-7 text-[#0b80ff]" />
        </div>
        <h1 className="text-xl font-bold text-[#1a202c] mb-2">بوابة الاقتناء</h1>
        {sent ? (
          <>
            <div className="w-12 h-12 rounded-full bg-[#f0fdf4] flex items-center justify-center mx-auto my-5">
              <CheckCircle2 className="w-6 h-6 text-[#16a34a]" />
            </div>
            <p className="text-[#555] leading-relaxed">تم إرسال رابط الدخول. تحقق من بريدك.</p>
          </>
        ) : (
          <>
            <p className="text-[#718096] mb-6 leading-relaxed text-sm">أدخل بريدك الإلكتروني لتلقّي رابط الدخول.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full py-[11px] px-[14px] border border-slate-200 rounded-[10px] text-sm mb-3 box-border ltr:direction-ltr"
              onKeyDown={(e) => e.key === 'Enter' && requestLink()}
            />
            {error && <p className="text-[#e53e3e] text-[13px] mb-2">{error}</p>}
            <button
              onClick={requestLink}
              disabled={sending || !email.trim()}
              className="w-full p-3 bg-[#0b80ff] text-white border-none rounded-[10px] text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {sending ? <Loader2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              إرسال رابط الدخول
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcquisitionPortal() {
  const { data, loading, error, refetch } = useApi<AcquisitionPortalResponse>('/api/acquisition-portal');
  const [uploading, setUploading] = useState<string | null>(null);
  const pdfInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function uploadPDF(studioId: string, file: File) {
    setUploading(studioId);
    try {
      const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/api/acquisition-portal/studios/${studioId}/production-file-upload-url`, {
        method: 'POST',
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      showNotice('تم رفع ملف الإنتاج وإشعار الاستوديو.');
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'فشل الرفع');
    } finally {
      setUploading(null);
    }
  }

  if (error?.includes('401') || error?.includes('Unauthorized')) return <LoginGate />;
  if (loading) return <LoginGate />;
  if (!data) return <LoginGate />;

  const studios = data.studios;

  return (
    <div className="min-h-screen bg-[#f5f7fa] font-sans" dir="rtl">
      <header className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-[960px] mx-auto h-[60px] flex items-center gap-3">
          <CloudUpload className="w-[22px] h-[22px] text-[#0b80ff]" />
          <span className="font-bold text-base text-[#1a202c]">بوابة الاقتناء — سماوي</span>
          <div className="mr-auto">
            <button
              onClick={() => fetch(`${API_BASE_URL}/api/acquisition-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
              className="bg-transparent border border-slate-200 rounded-lg py-[5px] px-3 text-[13px] text-[#718096] cursor-pointer"
            >
              خروج
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-[#1a202c] text-white py-3 px-6 rounded-xl text-sm z-[999]">
          {notice}
        </div>
      )}

      <main className="max-w-[960px] mx-auto py-7 px-5 grid gap-5">
        <h2 className="text-lg font-bold text-[#1a202c] m-0">الاستوديوهات ({studios.length})</h2>

        {studios.length === 0 && (
          <div className="bg-white rounded-2xl p-8 text-center text-[#a0aec0] text-sm">لا توجد استوديوهات نشطة.</div>
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
              <div className="mr-auto">
                <input type="file" accept=".pdf,application/pdf" className="hidden" ref={(el) => { pdfInputRef.current[studio.id] = el; }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPDF(studio.id, f); }} />
                <button disabled={uploading === studio.id}
                  onClick={() => pdfInputRef.current[studio.id]?.click()}
                  className="flex items-center gap-2 py-2 px-4 bg-[#0b80ff] text-white border-none rounded-[10px] text-[13px] font-semibold cursor-pointer disabled:opacity-60"
                >
                  <Upload className="w-[15px] h-[15px]" />
                  {uploading === studio.id ? 'جاري الرفع…' : 'رفع ملف إنتاج'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              {/* Production files */}
              <div>
                <p className="text-[13px] font-semibold text-[#4a5568] mb-2.5">ملفات الإنتاج ({productionFiles.length})</p>
                {productionFiles.length === 0 ? (
                  <p className="text-[13px] text-[#a0aec0]">لا توجد ملفات.</p>
                ) : (
                  <div className="grid gap-2">
                    {productionFiles.map((f) => (
                      <div key={f.id} className="flex items-center gap-2.5 py-2 px-3 border border-slate-200 rounded-[10px]">
                        <FileText className="w-4 h-4 text-[#e53e3e] shrink-0" />
                        <span className="flex-1 text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                        <span className="text-[11px] text-[#a0aec0]">{formatBytes(f.sizeBytes)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Books uploaded */}
              <div>
                <p className="text-[13px] font-semibold text-[#4a5568] mb-2.5">الكتب المرفوعة ({driveUploads.length})</p>
                {driveUploads.length === 0 ? (
                  <p className="text-[13px] text-[#a0aec0]">لم يرفع الاستوديو أي كتب بعد.</p>
                ) : (
                  <div className="grid gap-2">
                    {driveUploads.map((d) => (
                      <div key={d.id} className="flex items-center gap-2.5 py-2 px-3 border border-slate-200 rounded-[10px]">
                        <span className="flex-1 text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">{d.name}</span>
                        <DriveUploadStatusBadge status={d.status} />
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
