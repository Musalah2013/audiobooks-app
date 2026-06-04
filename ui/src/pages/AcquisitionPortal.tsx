import { useRef, useState } from 'react';
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
  return <span style={{ fontSize: 11, fontWeight: 600, color: info.color, background: `${info.color}18`, padding: '2px 8px', borderRadius: 99 }}>{info.label}</span>;
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
    <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, fontFamily: 'sans-serif' }} dir="rtl">
      <div style={{ background: '#fff', borderRadius: 20, maxWidth: 420, width: '100%', padding: '48px 40px', boxShadow: '0 8px 32px rgba(0,0,0,.08)', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(11,128,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <CloudUpload style={{ width: 28, height: 28, color: '#0b80ff' }} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a202c', marginBottom: 8 }}>بوابة الاقتناء</h1>
        {sent ? (
          <>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '20px auto 12px' }}>
              <CheckCircle2 style={{ width: 24, height: 24, color: '#16a34a' }} />
            </div>
            <p style={{ color: '#555', lineHeight: 1.7 }}>تم إرسال رابط الدخول. تحقق من بريدك.</p>
          </>
        ) : (
          <>
            <p style={{ color: '#718096', marginBottom: 24, lineHeight: 1.7, fontSize: 14 }}>أدخل بريدك الإلكتروني لتلقّي رابط الدخول.</p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com"
              style={{ width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, marginBottom: 12, boxSizing: 'border-box', direction: 'ltr' }}
              onKeyDown={(e) => e.key === 'Enter' && requestLink()} />
            {error && <p style={{ color: '#e53e3e', fontSize: 13, marginBottom: 8 }}>{error}</p>}
            <button onClick={requestLink} disabled={sending || !email.trim()}
              style={{ width: '100%', padding: 12, background: '#0b80ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: sending || !email.trim() ? 0.6 : 1 }}>
              {sending ? <Loader2 style={{ width: 16, height: 16 }} /> : <Send style={{ width: 16, height: 16 }} />}
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

  function showNotice(msg: string) { setNotice(msg); setTimeout(() => setNotice(''), 4000); }

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
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f5f7fa', fontFamily: 'sans-serif' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', gap: 12 }}>
          <CloudUpload style={{ width: 22, height: 22, color: '#0b80ff' }} />
          <span style={{ fontWeight: 700, fontSize: 16, color: '#1a202c' }}>بوابة الاقتناء — سماوي</span>
          <div style={{ marginRight: 'auto' }}>
            <button onClick={() => fetch(`${API_BASE_URL}/api/acquisition-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
              style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', fontSize: 13, color: '#718096', cursor: 'pointer' }}>
              خروج
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#1a202c', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, zIndex: 999 }}>
          {notice}
        </div>
      )}

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px', display: 'grid', gap: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a202c', margin: 0 }}>الاستوديوهات ({studios.length})</h2>

        {studios.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', color: '#a0aec0', fontSize: 14 }}>لا توجد استوديوهات نشطة.</div>
        )}

        {studios.map(({ studio, productionFiles, driveUploads }) => (
          <div key={studio.id} style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            {/* Studio header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              {studio.logoObjectKey ? (
                <img src={`${API_BASE_URL}/api/files/${studio.logoObjectKey}?preview=1`} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#edf2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0', fontSize: 18 }}>🏢</div>
              )}
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1a202c' }}>{studio.name}</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#718096' }}>{studio.contactEmail}</p>
              </div>
              <div style={{ marginRight: 'auto' }}>
                <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} ref={(el) => { pdfInputRef.current[studio.id] = el; }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPDF(studio.id, f); }} />
                <button disabled={uploading === studio.id}
                  onClick={() => pdfInputRef.current[studio.id]?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#0b80ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: uploading === studio.id ? 0.6 : 1 }}>
                  <Upload style={{ width: 15, height: 15 }} />
                  {uploading === studio.id ? 'جاري الرفع…' : 'رفع ملف إنتاج'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Production files */}
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#4a5568', marginBottom: 10 }}>ملفات الإنتاج ({productionFiles.length})</p>
                {productionFiles.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#a0aec0' }}>لا توجد ملفات.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {productionFiles.map((f) => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                        <FileText style={{ width: 16, height: 16, color: '#e53e3e', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ fontSize: 11, color: '#a0aec0' }}>{formatBytes(f.sizeBytes)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Books uploaded */}
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#4a5568', marginBottom: 10 }}>الكتب المرفوعة ({driveUploads.length})</p>
                {driveUploads.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#a0aec0' }}>لم يرفع الاستوديو أي كتب بعد.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {driveUploads.map((d) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                        <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
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
