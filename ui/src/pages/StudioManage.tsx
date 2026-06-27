import { useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Trash2, Download, CheckCircle2, XCircle, ImageIcon, FileText, Music, Link2, CloudUpload } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { Studio, StudioAsset, StudioProductionFile, StudioSample, StudioDriveUpload, BooksResponse } from '@api';

interface ManageData {
  studio: Studio;
  assets: StudioAsset[];
  productionFiles: StudioProductionFile[];
  samples: StudioSample[];
  driveUploads: StudioDriveUpload[];
}

type TabKey = 'info' | 'assets' | 'production' | 'samples' | 'deliveries';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function StudioManage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<ManageData>(`/api/studios/${id}`);
  const { data: sampleData, refetch: refetchSamples } = useApi<{ samples: StudioSample[] }>(`/api/studios/${id}/samples`);
  const { addToast } = useToast();
  const { isArabic } = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const { data: booksData } = useApi<BooksResponse>('/api/books');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const studio = data?.studio;
  const assets = data?.assets ?? [];
  const productionFiles = data?.productionFiles ?? [];
  const samples = sampleData?.samples ?? data?.samples ?? [];
  const driveUploads = data?.driveUploads ?? [];
  const bridgeableCount = driveUploads.filter((u) => u.status === 'completed' && !u.batchId).length;

  function xhrPut(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });
  }

  async function uploadLogo(file: File) {
    setUploading(true); setUploadProgress(0);
    try {
      const { uploadUrl } = await apiRequest<{ uploadUrl: string; objectKey: string }>(`/api/studios/${id}/logo-upload-url`, { method: 'POST', body: { contentType: file.type } });
      await xhrPut(uploadUrl, file);
      addToast(isArabic ? 'تم رفع الشعار.' : 'Logo uploaded.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الرفع' : 'Upload failed'), 'error');
    } finally {
      setUploading(false); setUploadProgress(0);
    }
  }

  async function uploadAsset(file: File) {
    setUploading(true); setUploadProgress(0);
    try {
      const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/api/studios/${id}/asset-upload-url`, { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
      await xhrPut(uploadUrl, file);
      addToast(isArabic ? 'تم رفع الملف.' : 'Asset uploaded.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الرفع' : 'Upload failed'), 'error');
    } finally {
      setUploading(false); setUploadProgress(0);
    }
  }

  async function uploadPDF(file: File) {
    setUploading(true); setUploadProgress(0);
    try {
      const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/api/studios/${id}/production-file-upload-url`, { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
      await xhrPut(uploadUrl, file);
      addToast(isArabic ? 'تم رفع ملف الإنتاج وإشعار الاستوديو.' : 'Production file uploaded and studio notified.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الرفع' : 'Upload failed'), 'error');
    } finally {
      setUploading(false); setUploadProgress(0);
    }
  }

  async function deleteAsset(assetId: string) {
    try {
      await apiRequest(`/api/studios/${id}/assets/${assetId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف الملف.' : 'Asset deleted.', 'success');
      setConfirmDelete(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    }
  }

  async function deletePDF(fileId: string) {
    try {
      await apiRequest(`/api/studios/${id}/production-files/${fileId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف الملف.' : 'File deleted.', 'success');
      setConfirmDelete(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    }
  }

  async function assignBook(fileId: string, audiobookId: string | null) {
    setAssigning(fileId);
    try {
      await apiRequest(`/api/studios/${id}/production-files/${fileId}/assign`, { method: 'PATCH', body: { audiobookId } });
      addToast(audiobookId ? (isArabic ? 'تم ربط الملف بالعنوان.' : 'Linked to catalog title.') : (isArabic ? 'تم إلغاء الربط.' : 'Assignment cleared.'), 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الربط' : 'Assign failed'), 'error');
    } finally {
      setAssigning(null);
    }
  }

  const [bridging, setBridging] = useState(false);
  async function bridgeDeliveries() {
    setBridging(true);
    try {
      const res = await apiRequest<{ batchId: string; bridgedDeliveries: number }>(`/api/studios/${id}/deliveries/create-batch`, { method: 'POST' });
      addToast(isArabic ? `تم إنشاء دفعة استيراد من ${res.bridgedDeliveries} تسليم.` : `Created an intake batch from ${res.bridgedDeliveries} deliver${res.bridgedDeliveries === 1 ? 'y' : 'ies'}.`, 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل إنشاء الدفعة' : 'Failed to create batch'), 'error');
    } finally {
      setBridging(false);
    }
  }

  async function reviewSample(sampleId: string, status: 'approved' | 'refused') {
    setReviewing(sampleId);
    try {
      await apiRequest(`/api/studios/${id}/samples/${sampleId}/review`, { method: 'POST', body: { status, note: reviewNote[sampleId] || null } });
      addToast(status === 'approved' ? (isArabic ? 'تمت الموافقة.' : 'Approved.') : (isArabic ? 'تم الرفض.' : 'Refused.'), 'success');
      setReviewNote((p) => { const n = { ...p }; delete n[sampleId]; return n; });
      refetchSamples();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل التحديث' : 'Failed'), 'error');
    } finally {
      setReviewing(null);
    }
  }

  if (loading) return <div className="card text-sm text-center text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  if (error || !studio) return <div className="card text-sm text-red-600">{error ?? 'Not found'}</div>;

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'info', label: isArabic ? 'المعلومات' : 'Info' },
    { key: 'assets', label: isArabic ? 'الملفات' : 'Assets', count: assets.length },
    { key: 'production', label: isArabic ? 'ملفات الإنتاج' : 'Production Files', count: productionFiles.length },
    { key: 'samples', label: isArabic ? 'العينات' : 'Samples', count: samples.length },
    { key: 'deliveries', label: isArabic ? 'التسليمات' : 'Deliveries', count: driveUploads.length },
  ];

  return (
    <div className="space-y-5">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link to="/studios" className="text-[color:var(--fg-2)] hover:text-[color:var(--samawy-ink)] transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-3">
          {studio.logoObjectKey ? (
            <img src={`${API_BASE}/api/files/${studio.logoObjectKey}?preview=1`} alt="" className="h-10 w-10 rounded-xl object-cover border border-slate-200" />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400"><ImageIcon className="h-5 w-5" /></div>
          )}
          <div>
            <h2 className="text-lg font-bold text-[color:var(--samawy-ink)]">{studio.name}</h2>
            <p className="text-xs text-[color:var(--fg-2)]">/studio/{studio.slug}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-100 pb-0">
        {tabs.map((t) => (
          <button key={t.key} type="button"
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === t.key ? 'border-[color:var(--samawy-blue)] text-[color:var(--samawy-blue)]' : 'border-transparent text-[color:var(--fg-2)] hover:text-[color:var(--samawy-ink)]'}`}
            onClick={() => setActiveTab(t.key)}>
            {t.label}{t.count !== undefined && t.count > 0 ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {activeTab === 'info' && (
        <div className="card space-y-5">
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><span className="text-[color:var(--fg-2)]">{isArabic ? 'البريد:' : 'Email:'}</span> <span className="font-medium">{studio.contactEmail}</span></div>
            <div><span className="text-[color:var(--fg-2)]">{isArabic ? 'الرابط:' : 'Slug:'}</span> <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{studio.slug}</code></div>
            {studio.driveFolderId && <div><span className="text-[color:var(--fg-2)]">{isArabic ? 'Drive:' : 'Drive:'}</span> <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{studio.driveFolderId}</code></div>}
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-[color:var(--fg-2)] mb-2">{isArabic ? 'شعار الاستوديو' : 'Studio Logo'}</p>
            <div className="flex items-center gap-3">
              {studio.logoObjectKey ? (
                <img src={`${API_BASE}/api/files/${studio.logoObjectKey}?preview=1`} alt="" className="h-16 w-16 rounded-xl object-cover border border-slate-200" />
              ) : (
                <div className="h-16 w-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-300"><ImageIcon className="h-7 w-7" /></div>
              )}
              <div className="space-y-2">
                <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                <button type="button" className="btn-secondary text-xs py-1.5 px-3" disabled={uploading} onClick={() => logoInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? `${uploadProgress}%` : (isArabic ? 'رفع شعار' : 'Upload Logo')}
                </button>
                {uploading && (
                  <div className="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[color:var(--samawy-blue)] rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assets tab */}
      {activeTab === 'assets' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-end gap-3">
            <input type="file" ref={assetInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAsset(f); }} />
            {uploading && (
              <div className="flex items-center gap-2 flex-1 max-w-[200px]">
                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[color:var(--samawy-blue)] rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                </div>
                <span className="text-xs text-[color:var(--fg-2)] tabular-nums w-8">{uploadProgress}%</span>
              </div>
            )}
            <button type="button" className="btn-primary text-sm" disabled={uploading} onClick={() => assetInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {uploading ? (isArabic ? 'جاري الرفع…' : 'Uploading…') : (isArabic ? 'رفع ملف' : 'Upload Asset')}
            </button>
          </div>
          {assets.length === 0 ? (
            <p className="text-sm text-center text-[color:var(--fg-2)] py-4">{isArabic ? 'لا توجد ملفات.' : 'No assets yet.'}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {assets.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={`${API_BASE}/api/files/${a.objectKey}?_dl=1`} className="btn-secondary text-xs py-1 px-2" title={isArabic ? 'تنزيل' : 'Download'} download>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {confirmDelete === a.id ? (
                      <div className="flex items-center gap-1">
                        <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteAsset(a.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                        <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDelete(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                      </div>
                    ) : (
                      <button type="button" className="text-red-400 hover:text-red-600 p-1 rounded" onClick={() => setConfirmDelete(a.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Production files tab */}
      {activeTab === 'production' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-end gap-3">
            <input type="file" ref={pdfInputRef} className="hidden" accept=".pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPDF(f); }} />
            {uploading && (
              <div className="flex items-center gap-2 flex-1 max-w-[200px]">
                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[color:var(--samawy-blue)] rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                </div>
                <span className="text-xs text-[color:var(--fg-2)] tabular-nums w-8">{uploadProgress}%</span>
              </div>
            )}
            <button type="button" className="btn-primary text-sm" disabled={uploading} onClick={() => pdfInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {uploading ? (isArabic ? 'جاري الرفع…' : 'Uploading…') : (isArabic ? 'رفع ملف PDF' : 'Upload PDF')}
            </button>
          </div>
          {productionFiles.length === 0 ? (
            <p className="text-sm text-center text-[color:var(--fg-2)] py-4">{isArabic ? 'لا توجد ملفات إنتاج.' : 'No production files yet.'}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {productionFiles.map((f) => (
                <div key={f.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 text-red-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(f.sizeBytes)} · {f.uploadedBy} · {new Date(f.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={`${API_BASE}/api/files/${f.objectKey}?_dl=1`} className="btn-secondary text-xs py-1 px-2" download>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {confirmDelete === f.id ? (
                      <div className="flex items-center gap-1">
                        <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deletePDF(f.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                        <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDelete(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                      </div>
                    ) : (
                      <button type="button" className="text-red-400 hover:text-red-600 p-1 rounded" onClick={() => setConfirmDelete(f.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>
                {/* Catalog assignment */}
                <div className="mt-2 flex items-center gap-2 pl-7">
                  <Link2 className="h-3.5 w-3.5 text-[color:var(--fg-2)] shrink-0" />
                  <select
                    className="text-xs rounded-lg border border-slate-200 bg-white px-2 py-1 max-w-[260px] disabled:opacity-50"
                    value={f.audiobookId ?? ''}
                    disabled={assigning === f.id}
                    onChange={(e) => assignBook(f.id, e.target.value || null)}
                  >
                    <option value="">{isArabic ? '— غير مرتبط بعنوان —' : '— Not linked to a title —'}</option>
                    {booksData?.books.map((b) => (
                      <option key={b.id} value={b.id}>{b.title}{b.publisherName ? ` · ${b.publisherName}` : ''}</option>
                    ))}
                  </select>
                  {f.audiobookId && (
                    <Link to={`/books/${f.audiobookId}`} className="text-xs text-[color:var(--samawy-blue)] underline shrink-0">
                      {isArabic ? 'عرض العنوان' : 'View title'}
                    </Link>
                  )}
                </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Samples tab */}
      {activeTab === 'samples' && (
        <div className="space-y-3">
          {samples.length === 0 ? (
            <div className="card text-sm text-center text-[color:var(--fg-2)] py-6">{isArabic ? 'لم يرفع الاستوديو أي عينات بعد.' : 'No samples submitted yet.'}</div>
          ) : samples.map((s) => (
            <div key={s.id} className="card space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <Music className="h-4 w-4 text-[color:var(--samawy-blue)]" />
                  <div>
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(s.sizeBytes)} · {new Date(s.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className={`badge-${s.status === 'approved' ? 'green' : s.status === 'refused' ? 'red' : 'yellow'}`}>
                  {s.status === 'approved' ? (isArabic ? 'موافقة' : 'Approved') : s.status === 'refused' ? (isArabic ? 'مرفوضة' : 'Refused') : (isArabic ? 'قيد المراجعة' : 'Pending')}
                </span>
              </div>
              <audio controls className="w-full" src={`${API_BASE}/api/files/${s.objectKey}?preview=1`} />
              {s.reviewNote && <p className="text-xs text-[color:var(--fg-2)] bg-slate-50 rounded-[10px] px-3 py-2">{s.reviewNote}</p>}
              {s.status === 'pending' && (
                <div className="flex gap-2 items-center flex-wrap">
                  <input className="input text-sm flex-1 min-w-[160px]" placeholder={isArabic ? 'ملاحظة (اختياري)' : 'Note (optional)'} value={reviewNote[s.id] ?? ''} onChange={(e) => setReviewNote((p) => ({ ...p, [s.id]: e.target.value }))} />
                  <button type="button" className="btn-primary text-xs py-1.5 px-3" disabled={reviewing === s.id} onClick={() => reviewSample(s.id, 'approved')}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {isArabic ? 'موافقة' : 'Approve'}
                  </button>
                  <button type="button" className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-200 hover:bg-red-50" disabled={reviewing === s.id} onClick={() => reviewSample(s.id, 'refused')}>
                    <XCircle className="h-3.5 w-3.5" />
                    {isArabic ? 'رفض' : 'Refuse'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Deliveries tab */}
      {activeTab === 'deliveries' && (
        <div className="space-y-3">
          <div className="card flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">{isArabic ? 'تسليمات الصوت النهائي' : 'Finished audio deliveries'}</p>
              <p className="text-xs text-[color:var(--fg-2)]">
                {isArabic
                  ? 'الملفات التي رفعها الاستوديو إلى Google Drive. أنشئ دفعة استيراد لمعالجتها في خط الإنتاج.'
                  : 'Files the studio delivered to Google Drive. Create an intake batch to process them through the pipeline.'}
              </p>
            </div>
            <button
              type="button"
              className="btn-primary text-xs py-2 px-3 disabled:opacity-50"
              disabled={bridging || bridgeableCount === 0}
              onClick={bridgeDeliveries}
              title={bridgeableCount === 0 ? (isArabic ? 'لا توجد تسليمات مكتملة غير مرتبطة' : 'No completed, unlinked deliveries') : undefined}
            >
              <Upload className="h-3.5 w-3.5" />
              {bridging
                ? (isArabic ? 'جاري الإنشاء…' : 'Creating…')
                : (isArabic ? `إنشاء دفعة استيراد (${bridgeableCount})` : `Create intake batch (${bridgeableCount})`)}
            </button>
          </div>
          {driveUploads.length === 0 ? (
            <div className="card text-sm text-center text-[color:var(--fg-2)] py-6">{isArabic ? 'لا توجد تسليمات بعد.' : 'No deliveries yet.'}</div>
          ) : (
            <div className="card divide-y divide-slate-100">
              {driveUploads.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CloudUpload className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-xs text-[color:var(--fg-2)]">{new Date(u.createdAt).toLocaleDateString()}{u.error ? ` · ${u.error}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.batchId ? (
                      <Link to={`/batches/${u.batchId}`} className="text-xs text-[color:var(--samawy-blue)] underline">
                        {isArabic ? 'عرض الدفعة' : 'View batch'}
                      </Link>
                    ) : (
                      <span className={`badge-${u.status === 'completed' ? 'green' : u.status === 'failed' ? 'red' : 'yellow'}`}>
                        {u.status === 'completed' ? (isArabic ? 'مكتمل' : 'Completed') : u.status === 'failed' ? (isArabic ? 'فشل' : 'Failed') : (isArabic ? 'قيد الرفع' : 'Uploading')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
