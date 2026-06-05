import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Upload, CheckCircle2, FileText, Music, CloudUpload, Send, Loader2 } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import type { StudioPortalResponse } from '@api';

const API_BASE_URL = typeof API_BASE === 'string' ? API_BASE : '';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'قيد الانتظار', cls: 'bg-yellow-100 text-yellow-800' },
    approved: { label: 'موافقة', cls: 'bg-green-100 text-green-800' },
    refused: { label: 'مرفوضة', cls: 'bg-red-100 text-red-800' },
    uploading: { label: 'جاري الرفع', cls: 'bg-blue-100 text-blue-800' },
    completed: { label: 'مكتمل', cls: 'bg-green-100 text-green-800' },
    failed: { label: 'فشل', cls: 'bg-red-100 text-red-800' },
  };
  const info = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${info.cls}`}>{info.label}</span>;
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
    <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', fontFamily: 'sans-serif' }} dir="rtl">
      <div style={{ background: '#fff', borderRadius: '20px', maxWidth: '440px', width: '100%', padding: '48px 40px', boxShadow: '0 8px 32px rgba(0,0,0,.08)', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(11,128,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <CloudUpload style={{ width: 28, height: 28, color: '#0b80ff' }} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a202c', marginBottom: 8 }}>بوابة سماوي للاستوديوهات</h1>
        {sent ? (
          <div>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px auto 16px' }}>
              <CheckCircle2 style={{ width: 28, height: 28, color: '#16a34a' }} />
            </div>
            <p style={{ color: '#555', lineHeight: 1.7 }}>تم إرسال رابط الدخول إلى بريدك الإلكتروني. تحقق من بريدك وانقر على الرابط للدخول.</p>
          </div>
        ) : (
          <>
            <p style={{ color: '#718096', marginBottom: 28, lineHeight: 1.7 }}>أدخل بريدك الإلكتروني المسجّل لتلقّي رابط الدخول.</p>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@studio.com"
              style={{ width: '100%', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 15, marginBottom: 12, boxSizing: 'border-box', direction: 'ltr' }}
              onKeyDown={(e) => e.key === 'Enter' && requestLink()}
            />
            {error && <p style={{ color: '#e53e3e', fontSize: 13, marginBottom: 8 }}>{error}</p>}
            <button onClick={requestLink} disabled={sending || !email.trim()}
              style={{ width: '100%', padding: '13px', background: '#0b80ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: sending || !email.trim() ? 0.6 : 1 }}>
              {sending ? <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 18, height: 18 }} />}
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const driveInputRef = useRef<HTMLInputElement>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');

  function showNotice(msg: string) { setNotice(msg); setTimeout(() => setNotice(''), 4000); }

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
      const { uploadUrl, uploadId } = await apiRequest<{ uploadUrl: string; uploadId: string }>(`/api/studio-portal/${slug}/drive-upload-url`, { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
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
      const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/api/studio-portal/${slug}/sample-upload-url`, { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      showNotice('تم رفع العينة وسيتم إشعار الفريق.');
      refetch();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'فشل رفع العينة');
    } finally {
      setUploading(false);
    }
  }

  // Unauthenticated — show login gate
  if (error?.includes('401') || error?.includes('Unauthorized')) return <LoginGate slug={slug ?? ''} />;
  if (loading) return <LoginGate slug={slug ?? ''} />;
  if (!data) return <LoginGate slug={slug ?? ''} />;

  const { studio, assets, productionFiles, samples, driveUploads } = data;

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f5f7fa', fontFamily: "'Cairo', sans-serif" }}>
      {/* Top bar */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 24px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', height: 64, display: 'flex', alignItems: 'center', gap: 16 }}>
          {studio.logoObjectKey ? (
            <img src={`${API_BASE_URL}/api/files/${studio.logoObjectKey}?preview=1`} alt={studio.name} style={{ height: 40, width: 40, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
          ) : null}
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1a202c', margin: 0 }}>{studio.name}</h1>
            <p style={{ fontSize: 12, color: '#718096', margin: 0 }}>بوابة سماوي للاستوديوهات</p>
          </div>
          <div style={{ marginRight: 'auto' }}>
            <button onClick={() => fetch(`${API_BASE_URL}/api/studio-auth/logout`, { method: 'POST', credentials: 'include' }).then(() => location.reload())}
              style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#718096', cursor: 'pointer' }}>
              تسجيل الخروج
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: '#1a202c', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
          {notice}
        </div>
      )}

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px', display: 'grid', gap: 24 }}>

        {/* Section helper */}
        {[
          {
            title: '📁 الملفات المرجعية',
            subtitle: 'ملفات رفعها فريق سماوي لمرجعيتك.',
            content: assets.length === 0 ? (
              <p style={{ color: '#a0aec0', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>لا توجد ملفات مرجعية بعد.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {assets.map((a) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
                    <FileText style={{ width: 20, height: 20, color: '#0b80ff', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#718096' }}>{formatBytes(a.sizeBytes)}</p>
                    </div>
                    <button onClick={async () => { const url = await getDownloadUrl(a.objectKey); window.open(url, '_blank'); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f7fafc', fontSize: 13, cursor: 'pointer', color: '#4a5568' }}>
                      <Download style={{ width: 14, height: 14 }} /> تنزيل
                    </button>
                  </div>
                ))}
              </div>
            ),
          },
          {
            title: '☁️ رفع الكتب إلى Drive',
            subtitle: 'ارفع ملفات الكتاب الصوتي النهائية لتُحفظ في Google Drive.',
            content: (
              <>
                <input type="file" ref={driveInputRef} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDriveUpload(f); }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                  <button disabled={uploading} onClick={() => driveInputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#0b80ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                    <CloudUpload style={{ width: 18, height: 18 }} />
                    {uploading ? 'جاري الرفع…' : 'رفع ملف'}
                  </button>
                  {uploading && uploadProgress > 0 && (
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#0b80ff', width: `${uploadProgress}%`, transition: 'width 0.2s' }} />
                      </div>
                      <p style={{ fontSize: 12, color: '#718096', margin: '4px 0 0' }}>{uploadProgress}%</p>
                    </div>
                  )}
                </div>
                {driveUploads.length === 0 ? (
                  <p style={{ color: '#a0aec0', fontSize: 14, textAlign: 'center' }}>لم يتم رفع أي ملفات بعد.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {driveUploads.map((d) => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
                        <p style={{ flex: 1, margin: 0, fontSize: 14, fontWeight: 500, color: '#1a202c' }}>{d.name}</p>
                        <StatusBadge status={d.status} />
                        {d.driveFileId && <a href={`https://drive.google.com/file/d/${d.driveFileId}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0b80ff', textDecoration: 'none' }}>فتح في Drive ↗</a>}
                        {d.error && <span style={{ fontSize: 12, color: '#e53e3e' }}>{d.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ),
          },
          {
            title: '📄 ملفات الإنتاج',
            subtitle: 'ملفات PDF أرسلها إليك فريق سماوي لمتابعة الإنتاج.',
            content: productionFiles.length === 0 ? (
              <p style={{ color: '#a0aec0', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>لا توجد ملفات إنتاج بعد.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {productionFiles.map((f) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
                    <FileText style={{ width: 20, height: 20, color: '#e53e3e', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: '#1a202c' }}>{f.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#718096' }}>{formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString('ar')}</p>
                    </div>
                    <button onClick={async () => { const url = await getPdfDownloadUrl(f.objectKey); window.open(url, '_blank'); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f7fafc', fontSize: 13, cursor: 'pointer', color: '#4a5568' }}>
                      <Download style={{ width: 14, height: 14 }} /> تنزيل
                    </button>
                  </div>
                ))}
              </div>
            ),
          },
          {
            title: '🎵 العينات الصوتية',
            subtitle: 'ارفع عينات صوتية لمراجعتها وإبداء الموافقة من فريق سماوي.',
            content: (
              <>
                <input type="file" ref={sampleInputRef} style={{ display: 'none' }} accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSampleUpload(f); }} />
                <button disabled={uploading} onClick={() => sampleInputRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#0b80ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 16, opacity: uploading ? 0.6 : 1 }}>
                  <Upload style={{ width: 18, height: 18 }} />
                  {uploading ? 'جاري الرفع…' : 'رفع عينة صوتية'}
                </button>
                {samples.length === 0 ? (
                  <p style={{ color: '#a0aec0', fontSize: 14, textAlign: 'center' }}>لم تُرفع أي عينات بعد.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {samples.map((s) => (
                      <div key={s.id} style={{ padding: 16, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <Music style={{ width: 18, height: 18, color: '#0b80ff' }} />
                          <p style={{ flex: 1, margin: 0, fontWeight: 600, fontSize: 14 }}>{s.name}</p>
                          <StatusBadge status={s.status} />
                        </div>
                        <audio controls style={{ width: '100%', marginBottom: s.reviewNote ? 8 : 0 }} src={`${API_BASE_URL}/api/files/${s.objectKey}?preview=1`} />
                        {s.reviewNote && <p style={{ margin: 0, fontSize: 13, color: '#718096', background: '#f7fafc', padding: '8px 12px', borderRadius: 8 }}><strong>ملاحظة:</strong> {s.reviewNote}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ),
          },
        ].map(({ title, subtitle, content }) => (
          <section key={title} style={{ background: '#fff', borderRadius: 20, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1a202c', margin: '0 0 4px' }}>{title}</h2>
            <p style={{ fontSize: 13, color: '#718096', margin: '0 0 20px' }}>{subtitle}</p>
            {content}
          </section>
        ))}
      </main>
    </div>
  );
}
