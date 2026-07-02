import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Upload, Trash2, Download, CheckCircle2, XCircle, ImageIcon, FileText, Music, Link2, CloudUpload, Mail, DollarSign, Plus, Pencil, Search, ChevronDown, BookOpen, KeyRound } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { AudioPlayer } from '../components/AudioPlayer';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { Studio, StudioContact, StudioAsset, StudioProductionFile, StudioSample, StudioDriveUpload, StudioLegacyProduction } from '@api';

interface ManageData {
  studio: Studio;
  contacts: StudioContact[];
  assets: StudioAsset[];
  productionFiles: StudioProductionFile[];
  samples: StudioSample[];
  driveUploads: StudioDriveUpload[];
  legacyProductions: StudioLegacyProduction[];
}

function fmtHours(h: number | null | undefined) {
  return h == null ? '—' : `${h} h`;
}

type TabKey = 'info' | 'assets' | 'production' | 'samples' | 'deliveries' | 'audit';

interface AuditEvent { id: string; action: string; actor: string; createdAt: string; detail: Record<string, unknown> | null }

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function StudioManage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<ManageData>(`/api/studios/${id}`);
  const { data: sampleData, refetch: refetchSamples } = useApi<{ samples: StudioSample[] }>(`/api/studios/${id}/samples`);
  const { data: auditData, refetch: refetchAudit } = useApi<{ events: AuditEvent[] }>(`/api/studios/${id}/audit`);
  const { addToast } = useToast();
  const { isArabic } = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bulk, setBulk] = useState<{ done: number; total: number; name: string } | null>(null);
  const [dragTarget, setDragTarget] = useState<'asset' | 'production' | null>(null);
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [confirmDeleteSample, setConfirmDeleteSample] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { data: genresData } = useApi<{ genres: { id: string | number | null; name: string }[] }>('/api/sellers/genres');
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [newContactEmail, setNewContactEmail] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [pushingDelivery, setPushingDelivery] = useState<string | null>(null);
  const [confirmDeleteDelivery, setConfirmDeleteDelivery] = useState<string | null>(null);
  const [pushFormFor, setPushFormFor] = useState<string | null>(null);
  const [editingHours, setEditingHours] = useState<string | null>(null);
  const [hoursDraft, setHoursDraft] = useState<string>('');
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [savingHours, setSavingHours] = useState<string | null>(null);
  const [sellerQuery, setSellerQuery] = useState('');
  const [sellerResults, setSellerResults] = useState<{ id: number; name: string }[]>([]);
  const [pushSeller, setPushSeller] = useState<{ id: number; name: string } | null>(null);
  const [metaDraft, setMetaDraft] = useState({ title: '', author: '', isbn: '', narrator: '', genre: '', pubYear: '', sellingType: '', price: '' });
  const [editingProd, setEditingProd] = useState<string | null>(null);
  const [prodDraft, setProdDraft] = useState<{ bookTitle: string; narrator: string; isbn: string; netHours: string; notes: string }>({ bookTitle: '', narrator: '', isbn: '', netHours: '', notes: '' });
  const [confirmDeleteProd, setConfirmDeleteProd] = useState<string | null>(null);

  const studio = data?.studio;
  const contacts = data?.contacts ?? [];
  const assets = data?.assets ?? [];
  const productionFiles = data?.productionFiles ?? [];
  const samples = sampleData?.samples ?? data?.samples ?? [];
  const driveUploads = data?.driveUploads ?? [];

  const [sampleSearch, setSampleSearch] = useState('');
  const [sampleStatusFilter, setSampleStatusFilter] = useState('');
  const [sampleBookFilter, setSampleBookFilter] = useState('');
  const [collapsedSampleGroups, setCollapsedSampleGroups] = useState<Set<string>>(new Set());
  const toggleSampleGroup = (key: string) => setCollapsedSampleGroups((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const filteredSamples = useMemo(() => samples.filter((s) => {
    if (sampleSearch && !s.name.toLowerCase().includes(sampleSearch.toLowerCase())) return false;
    if (sampleStatusFilter && s.status !== sampleStatusFilter) return false;
    if (sampleBookFilter === '__none__') return !s.bookId;
    if (sampleBookFilter && s.bookId !== sampleBookFilter) return false;
    return true;
  }), [samples, sampleSearch, sampleStatusFilter, sampleBookFilter]);

  const groupedSamples = useMemo(() => {
    const groups = new Map<string, { key: string; bookName: string | null; items: typeof filteredSamples }>();
    for (const s of filteredSamples) {
      const key = s.bookId ?? '__none__';
      if (!groups.has(key)) groups.set(key, { key, bookName: s.bookName ?? null, items: [] });
      groups.get(key)!.items.push(s);
    }
    return [...groups.values()].sort((a, b) => a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : (a.bookName ?? '').localeCompare(b.bookName ?? ''));
  }, [filteredSamples]);

  const sampleBookOptions = useMemo(() => {
    const seen = new Map<string, string>();
    let hasUnlinked = false;
    for (const s of samples) { if (s.bookId) seen.set(s.bookId, s.bookName ?? s.bookId); else hasUnlinked = true; }
    return { books: [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), hasUnlinked };
  }, [samples]);
  const legacyProductions = data?.legacyProductions ?? [];

  useEffect(() => {
    if (studio) setRateInput(studio.hourlyRateUsd != null ? String(studio.hourlyRateUsd) : '');
  }, [studio?.id, studio?.hourlyRateUsd]);

  async function addContact() {
    const email = newContactEmail.trim();
    if (!email) return;
    setSavingContact(true);
    try {
      await apiRequest(`/api/studios/${id}/contacts`, { method: 'POST', body: { email } });
      setNewContactEmail('');
      addToast(isArabic ? 'تمت إضافة المستخدم.' : 'User added.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإضافة' : 'Failed to add'), 'error');
    } finally { setSavingContact(false); }
  }

  async function setContactPassword(contactId: string) {
    const pw = window.prompt(isArabic ? 'كلمة مرور جديدة (8 أحرف على الأقل):' : 'New password (min 8 chars):');
    if (pw == null) return;
    if (pw.length < 8) { addToast(isArabic ? 'كلمة المرور قصيرة جداً' : 'Password too short', 'error'); return; }
    try {
      await apiRequest(`/api/studios/${id}/contacts/${contactId}/set-password`, { method: 'POST', body: { password: pw } });
      addToast(isArabic ? 'تم تعيين كلمة المرور.' : 'Password set.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل التعيين' : 'Failed to set'), 'error');
    }
  }

  async function removeContact(contactId: string) {
    try {
      await apiRequest(`/api/studios/${id}/contacts/${contactId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف المستخدم.' : 'User removed.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Failed to remove'), 'error');
    }
  }

  async function searchPushSellers() {
    try {
      const res = await apiRequest<{ sellers: { id: number; name: string }[] }>(`/api/sellers?q=${encodeURIComponent(sellerQuery)}`);
      setSellerResults(res.sellers);
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل البحث' : 'Search failed'), 'error');
    }
  }

  function openPushForm(uploadId: string) {
    setPushFormFor(pushFormFor === uploadId ? null : uploadId);
    setPushSeller(null); setSellerQuery(''); setSellerResults([]);
    setMetaDraft({ title: '', author: '', isbn: '', narrator: '', genre: '', pubYear: '', sellingType: '', price: '' });
  }

  // metadata: null → assigned delivery (attach directly); object → create new book
  async function pushDelivery(uploadId: string, metadata?: Record<string, unknown>) {
    setPushingDelivery(uploadId);
    try {
      const res = await apiRequest<{ mode: string }>(`/api/studios/${id}/deliveries/${uploadId}/push`, { method: 'POST', body: metadata ? { metadata } : {} });
      addToast(res.mode === 'created' ? (isArabic ? 'تم إنشاء العنوان ودفع الملف.' : 'Created the title and pushed the file.') : (isArabic ? 'تم دفع التسليم إلى العنوان.' : 'Pushed to the catalog title.'), 'success');
      setPushFormFor(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الدفع' : 'Push failed'), 'error');
    } finally { setPushingDelivery(null); }
  }

  function submitPushForm(uploadId: string) {
    if (!pushSeller || !metaDraft.title.trim()) return;
    pushDelivery(uploadId, {
      sellerId: pushSeller.id, sellerName: pushSeller.name,
      title: metaDraft.title.trim(),
      author: metaDraft.author.trim() || null,
      isbn: metaDraft.isbn.trim() || null,
      narrator: metaDraft.narrator.trim() || null,
      genre: metaDraft.genre.trim() || null,
      pubYear: metaDraft.pubYear.trim() || null,
      sellingType: metaDraft.sellingType || null,
      price: metaDraft.price.trim() === '' ? null : Number(metaDraft.price),
    });
  }

  async function deleteDelivery(uploadId: string) {
    try {
      await apiRequest(`/api/studios/${id}/deliveries/${uploadId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف التسليم.' : 'Delivery deleted.', 'success');
      setConfirmDeleteDelivery(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    }
  }

  async function saveDeliveryHours(uploadId: string) {
    setSavingHours(uploadId);
    try {
      const v = hoursDraft.trim() === '' ? null : Number(hoursDraft);
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(isArabic ? 'قيمة غير صالحة' : 'Invalid value');
      await apiRequest(`/api/studios/${id}/deliveries/${uploadId}`, { method: 'PATCH', body: { netFinalHours: v, notes: notesDraft.trim() || null } });
      addToast(isArabic ? 'تم تحديث الساعات.' : 'Net hours updated.', 'success');
      setEditingHours(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحفظ' : 'Failed to save'), 'error');
    } finally { setSavingHours(null); }
  }

  function startEditProd(p: StudioLegacyProduction) {
    setEditingProd(p.id);
    setProdDraft({
      bookTitle: p.bookTitle,
      narrator: p.narrator ?? '',
      isbn: p.isbn ?? '',
      netHours: p.netHours != null ? String(p.netHours) : '',
      notes: p.notes ?? '',
    });
  }

  async function saveProd(prodId: string) {
    try {
      await apiRequest(`/api/studios/${id}/legacy-productions/${prodId}`, {
        method: 'PATCH',
        body: {
          bookTitle: prodDraft.bookTitle.trim(),
          narrator: prodDraft.narrator.trim() || null,
          isbn: prodDraft.isbn.trim() || null,
          netHours: prodDraft.netHours.trim() === '' ? null : Number(prodDraft.netHours),
          notes: prodDraft.notes.trim() || null,
        },
      });
      addToast(isArabic ? 'تم الحفظ.' : 'Saved.', 'success');
      setEditingProd(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحفظ' : 'Failed to save'), 'error');
    }
  }

  async function deleteProd(prodId: string) {
    try {
      await apiRequest(`/api/studios/${id}/legacy-productions/${prodId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم الحذف.' : 'Deleted.', 'success');
      setConfirmDeleteProd(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Failed to delete'), 'error');
    }
  }

  async function saveRate() {
    setSavingRate(true);
    try {
      const v = rateInput.trim() === '' ? null : Number(rateInput);
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(isArabic ? 'قيمة غير صالحة' : 'Invalid value');
      await apiRequest(`/api/studios/${id}`, { method: 'PATCH', body: { hourlyRateUsd: v } });
      addToast(isArabic ? 'تم حفظ السعر.' : 'Rate saved.', 'success');
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحفظ' : 'Failed to save'), 'error');
    } finally { setSavingRate(false); }
  }

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

  // Bulk upload (multiple files, one at a time) for assets or production files.
  async function bulkUpload(files: File[], kind: 'asset' | 'production') {
    const list = files.filter(Boolean);
    if (list.length === 0) return;
    const endpoint = kind === 'asset' ? 'asset-upload-url' : 'production-file-upload-url';
    setUploading(true);
    let ok = 0; const failedNames: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setBulk({ done: i, total: list.length, name: file.name });
      setUploadProgress(0);
      try {
        const { uploadUrl, objectKey } = await apiRequest<{ uploadUrl: string; objectKey: string }>(`/api/studios/${id}/${endpoint}`, { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
        await xhrPut(uploadUrl, file);
        if (kind === 'production') {
          await apiRequest(`/api/studios/${id}/production-files/complete`, { method: 'POST', body: { objectKey, fileName: file.name, contentType: file.type || 'application/pdf', sizeBytes: file.size } });
        }
        ok += 1;
      } catch {
        failedNames.push(file.name);
      }
    }
    setBulk(null);
    setUploading(false); setUploadProgress(0);
    if (failedNames.length) addToast(`${isArabic ? 'تم رفع' : 'Uploaded'} ${ok}/${list.length}. ${isArabic ? 'فشل:' : 'Failed:'} ${failedNames.join(', ')}`, 'error');
    else addToast(`${isArabic ? 'تم رفع' : 'Uploaded'} ${ok} ${isArabic ? 'ملف' : 'file(s)'}.`, 'success');
    refetch();
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

  async function deleteSample(sampleId: string) {
    try {
      await apiRequest(`/api/studios/${id}/samples/${sampleId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف العينة.' : 'Sample deleted.', 'success');
      setConfirmDeleteSample(null);
      refetchSamples();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    }
  }

  function renderDropzone(kind: 'asset' | 'production', accept: string | undefined, label: string, hint: string) {
    const active = dragTarget === kind;
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragTarget(kind); }}
        onDragLeave={(e) => { e.preventDefault(); setDragTarget(null); }}
        onDrop={(e) => { e.preventDefault(); setDragTarget(null); const files = Array.from(e.dataTransfer.files); if (files.length && !uploading) bulkUpload(files, kind); }}
        className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${active ? 'border-[color:var(--samawy-blue)] bg-[rgba(11,128,255,0.06)]' : 'border-slate-200'}`}
      >
        <input type="file" multiple accept={accept} className="hidden" id={`dz-${kind}`} disabled={uploading}
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) bulkUpload(fs, kind); e.target.value = ''; }} />
        <CloudUpload className="h-7 w-7 mx-auto mb-2 text-slate-300" />
        {uploading && bulk ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{isArabic ? 'جاري الرفع' : 'Uploading'} {bulk.done + 1}/{bulk.total}</p>
            <p className="text-xs text-[color:var(--fg-2)] truncate">{bulk.name}</p>
            <div className="h-1.5 max-w-[240px] mx-auto bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-[color:var(--samawy-blue)] rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-[color:var(--samawy-ink)]">{active ? (isArabic ? 'أفلِت للرفع' : 'Drop to upload') : label}</p>
            <p className="text-xs text-[color:var(--fg-2)] mb-2">{hint}</p>
            <label htmlFor={`dz-${kind}`} className="btn-secondary text-xs cursor-pointer inline-flex">
              <Upload className="h-3.5 w-3.5" />{isArabic ? 'اختيار ملفات' : 'Choose files'}
            </label>
          </>
        )}
      </div>
    );
  }

  if (loading) return <div className="card text-sm text-center text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  if (error || !studio) return <div className="card text-sm text-red-600">{error ?? 'Not found'}</div>;

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'info', label: isArabic ? 'المعلومات' : 'Info' },
    { key: 'assets', label: isArabic ? 'الملفات' : 'Assets', count: assets.length },
    { key: 'production', label: isArabic ? 'ملفات الإنتاج' : 'Production Files', count: productionFiles.length },
    { key: 'samples', label: isArabic ? 'العينات' : 'Samples', count: samples.length },
    { key: 'deliveries', label: isArabic ? 'التسليمات' : 'Deliveries', count: driveUploads.length },
    { key: 'audit', label: isArabic ? 'السجل' : 'Audit Log' },
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

          {/* Studio users (login contacts) */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-[color:var(--fg-2)] mb-2 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{isArabic ? 'مستخدمو الاستوديو (بريد الدخول)' : 'Studio users (login emails)'}</p>
            <div className="space-y-1.5 mb-2">
              {contacts.map((ct) => (
                <div key={ct.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-1.5">
                  <span className="text-sm truncate flex items-center gap-2">
                    {ct.email}
                    {ct.hasPassword === false && <span className="text-[10px] text-amber-600">{isArabic ? '(بدون كلمة مرور)' : '(no password)'}</span>}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" className="text-slate-400 hover:text-[color:var(--samawy-blue)]" onClick={() => setContactPassword(ct.id)} title={isArabic ? 'تعيين كلمة المرور' : 'Set password'}>
                      <KeyRound className="h-3.5 w-3.5" />
                    </button>
                    {contacts.length > 1 && (
                      <button type="button" className="text-red-400 hover:text-red-600" onClick={() => removeContact(ct.id)} title={isArabic ? 'حذف' : 'Remove'}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="input flex-1 text-sm" type="email" placeholder={isArabic ? 'بريد إلكتروني جديد' : 'New email'} value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addContact()} />
              <button type="button" className="btn-secondary text-xs px-3" disabled={savingContact || !newContactEmail.trim()} onClick={addContact}>
                <Plus className="h-3.5 w-3.5" />{isArabic ? 'إضافة' : 'Add'}
              </button>
            </div>
          </div>

          {/* Hourly rate */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-[color:var(--fg-2)] mb-2 flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" />{isArabic ? 'سعر الساعة النهائية (USD)' : 'Final hour rate (USD)'}</p>
            <div className="flex gap-2 items-center">
              <input className="input w-40 text-sm" type="number" min="0" step="0.01" placeholder="0.00" value={rateInput} onChange={(e) => setRateInput(e.target.value)} />
              <span className="text-xs text-[color:var(--fg-2)]">{isArabic ? '/ ساعة صافية' : '/ net hour'}</span>
              <button type="button" className="btn-secondary text-xs px-3" disabled={savingRate} onClick={saveRate}>
                <CheckCircle2 className="h-3.5 w-3.5" />{savingRate ? '…' : (isArabic ? 'حفظ' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assets tab */}
      {activeTab === 'assets' && (
        <div className="card space-y-4">
          {renderDropzone('asset', undefined, isArabic ? 'اسحب وأفلِت الملفات هنا' : 'Drag & drop files here', isArabic ? 'يمكن رفع عدة ملفات دفعة واحدة' : 'Upload multiple files at once')}
          {assets.length === 0 ? (
            <p className="text-sm text-center text-[color:var(--fg-2)] py-4">{isArabic ? 'لا توجد ملفات.' : 'No assets yet.'}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {assets.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        {a.shared && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 shrink-0">{isArabic ? 'مشترك' : 'Shared'}</span>}
                      </div>
                      <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={`${API_BASE}/api/files/${a.objectKey}?_dl=1`} className="btn-secondary text-xs py-1 px-2" title={isArabic ? 'تنزيل' : 'Download'} download>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {a.shared ? (
                      <span className="text-[10px] text-[color:var(--fg-2)]">{isArabic ? 'يُدار مركزياً' : 'Managed centrally'}</span>
                    ) : confirmDelete === a.id ? (
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
          {renderDropzone('production', '.pdf,application/pdf', isArabic ? 'اسحب وأفلِت ملفات الإنتاج هنا' : 'Drag & drop production files here', isArabic ? 'يمكن رفع عدة ملفات دفعة واحدة' : 'Upload multiple files at once')}
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{f.name}</p>
                        {f.productionStatus && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${f.productionStatus === 'delivered' ? 'bg-emerald-50 text-emerald-700' : f.productionStatus === 'in_production' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                            {f.productionStatus === 'delivered' ? (isArabic ? 'تم التسليم' : 'Delivered') : f.productionStatus === 'in_production' ? (isArabic ? 'قيد الإنتاج' : 'In Production') : (isArabic ? 'قائمة الانتظار' : 'Backlog')}
                          </span>
                        )}
                      </div>
                      {f.bookAuthor && <p className="text-xs text-[color:var(--fg-2)] truncate">{isArabic ? 'المؤلف:' : 'Author:'} {f.bookAuthor}</p>}
                      <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(f.sizeBytes)} · {f.uploadedBy} · {new Date(f.createdAt).toLocaleDateString()}</p>
                      {f.acqNotes && <p className="text-xs text-[color:var(--fg-2)] mt-0.5 italic">{f.acqNotes}</p>}
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
                {/* Existing catalog link (read-only — assigning was removed; new titles
                    are created when the operator pushes a delivery with metadata) */}
                {f.audiobookId && (
                  <div className="mt-2 flex items-center gap-2 pl-7">
                    <Link2 className="h-3.5 w-3.5 text-[color:var(--fg-2)] shrink-0" />
                    <span className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'مرتبط بعنوان:' : 'Linked title:'} <strong className="text-[color:var(--samawy-ink)]">{f.audiobookTitle ?? f.audiobookId}</strong></span>
                    <Link to={`/books/${f.audiobookId}`} className="text-xs text-[color:var(--samawy-blue)] underline shrink-0">
                      {isArabic ? 'عرض العنوان' : 'View title'}
                    </Link>
                  </div>
                )}
                {/* Studio production plan (read-only) */}
                {(f.narrator || f.expectedNetHours != null || f.estimatedFinishHours != null) && (
                  <div className="mt-2 ml-7 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--fg-2)]">
                    {f.narrator && <span>{isArabic ? 'الراوي:' : 'Narrator:'} <strong className="text-[color:var(--samawy-ink)]">{f.narrator}</strong></span>}
                    <span>{isArabic ? 'ساعات صافية متوقعة:' : 'Expected net:'} <strong className="text-[color:var(--samawy-ink)]">{fmtHours(f.expectedNetHours)}</strong></span>
                    <span>{isArabic ? 'إنجاز مقدّر:' : 'Est. finish:'} <strong className="text-[color:var(--samawy-ink)]">{fmtHours(f.estimatedFinishHours)}</strong></span>
                  </div>
                )}
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
          ) : (
            <>
              {/* Filter bar */}
              <div className="card flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
                  <input className="input w-full ltr:pl-9 rtl:pr-9 text-sm" placeholder={isArabic ? 'البحث في العينات…' : 'Search samples…'} value={sampleSearch} onChange={(e) => setSampleSearch(e.target.value)} />
                </div>
                <select className="input text-sm w-auto" value={sampleStatusFilter} onChange={(e) => setSampleStatusFilter(e.target.value)}>
                  <option value="">{isArabic ? 'كل الحالات' : 'All statuses'}</option>
                  <option value="pending">{isArabic ? 'قيد المراجعة' : 'Pending'}</option>
                  <option value="approved">{isArabic ? 'معتمدة' : 'Approved'}</option>
                  <option value="refused">{isArabic ? 'مرفوضة' : 'Refused'}</option>
                </select>
                <select className="input text-sm w-auto max-w-[220px]" value={sampleBookFilter} onChange={(e) => setSampleBookFilter(e.target.value)}>
                  <option value="">{isArabic ? 'كل الكتب' : 'All books'}</option>
                  {sampleBookOptions.books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  {sampleBookOptions.hasUnlinked && <option value="__none__">{isArabic ? 'غير مرتبط بكتاب' : 'Unlinked'}</option>}
                </select>
                <span className="text-xs text-[color:var(--fg-2)] whitespace-nowrap">{filteredSamples.length} {isArabic ? 'عينة' : 'samples'}</span>
              </div>

              {filteredSamples.length === 0 ? (
                <div className="card text-sm text-center text-[color:var(--fg-2)] py-6">{isArabic ? 'لا توجد نتائج.' : 'No matching samples.'}</div>
              ) : groupedSamples.map((g) => {
                const collapsed = collapsedSampleGroups.has(g.key);
                return (
                  <div key={g.key} className="card p-0 overflow-hidden">
                    <button type="button" onClick={() => toggleSampleGroup(g.key)} className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50/60 hover:bg-slate-50 transition-colors text-start">
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                      <BookOpen className={`h-4 w-4 ${g.key === '__none__' ? 'text-slate-400' : 'text-[color:var(--samawy-blue)]'}`} />
                      <h3 className={`text-sm font-bold flex-1 ${g.key === '__none__' ? 'text-slate-500' : 'text-[color:var(--samawy-ink)]'}`}>{g.bookName ?? (isArabic ? 'غير مرتبط بكتاب' : 'Unlinked')}</h3>
                      <span className="text-xs text-[color:var(--fg-2)]">{g.items.length}</span>
                    </button>
                    {!collapsed && (
                      <div className="p-4 space-y-3">
                        {g.items.map((s) => (
                          <div key={s.id} className="rounded-xl border border-slate-100 p-3 space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2.5">
                                <Music className="h-4 w-4 text-[color:var(--samawy-blue)]" />
                                <div>
                                  <p className="text-sm font-semibold">{s.name}</p>
                                  <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(s.sizeBytes)} · {new Date(s.createdAt).toLocaleDateString()}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`badge-${s.status === 'approved' ? 'green' : s.status === 'refused' ? 'red' : 'yellow'}`}>
                                  {s.status === 'approved' ? (isArabic ? 'موافقة' : 'Approved') : s.status === 'refused' ? (isArabic ? 'مرفوضة' : 'Refused') : (isArabic ? 'قيد المراجعة' : 'Pending')}
                                </span>
                                {confirmDeleteSample === s.id ? (
                                  <span className="flex items-center gap-1">
                                    <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteSample(s.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                                    <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDeleteSample(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                                  </span>
                                ) : (
                                  <button type="button" className="text-red-400 hover:text-red-600 p-1" title={isArabic ? 'حذف العينة' : 'Delete sample'} onClick={() => setConfirmDeleteSample(s.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                                )}
                              </div>
                            </div>
                            <AudioPlayer src={`${API_BASE}/api/files/${s.objectKey}?preview=1`} />
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
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Deliveries tab */}
      {activeTab === 'deliveries' && (
        <div className="space-y-3">
          <div className="card">
            <p className="text-sm font-semibold">{isArabic ? 'تسليمات الصوت النهائي' : 'Finished audio deliveries'}</p>
            <p className="text-xs text-[color:var(--fg-2)]">
              {isArabic
                ? 'الملفات النهائية التي رفعها الاستوديو. راجِع كل ملف ثم ادفعه إلى نظام الكتب الصوتية أو احذفه.'
                : 'Finished audio the studio uploaded. Review each file, then push it into the audiobooks system or delete it.'}
            </p>
          </div>
          {driveUploads.length === 0 ? (
            <div className="card text-sm text-center text-[color:var(--fg-2)] py-6">{isArabic ? 'لا توجد تسليمات بعد.' : 'No deliveries yet.'}</div>
          ) : (
            <div className="card divide-y divide-slate-100">
              {driveUploads.map((u) => {
                const rate = studio?.hourlyRateUsd ?? null;
                const cost = rate != null && u.netFinalHours != null ? rate * u.netFinalHours : null;
                return (
                <div key={u.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CloudUpload className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-xs text-[color:var(--fg-2)]">{new Date(u.createdAt).toLocaleDateString()}{u.error ? ` · ${u.error}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.audiobookId && <span className="badge-blue !px-2 !py-0.5 !text-[10px]">{isArabic ? 'مُسنَد' : 'Assigned'}</span>}
                    {u.batchId && (
                      <Link to={`/batches/${u.batchId}`} className="text-xs text-[color:var(--samawy-blue)] underline">
                        {isArabic ? 'عرض الدفعة' : 'View batch'}
                      </Link>
                    )}
                    {u.status === 'pushed' ? (
                      <span className="badge-green !px-2 !py-0.5 !text-[10px]">{isArabic ? 'تم الدفع' : 'Pushed'}</span>
                    ) : u.status === 'completed' ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary text-xs py-1 px-2.5 disabled:opacity-50"
                          disabled={pushingDelivery === u.id}
                          onClick={() => u.audiobookId ? pushDelivery(u.id) : openPushForm(u.id)}
                        >
                          <Upload className="h-3.5 w-3.5" />{pushingDelivery === u.id ? '…' : (isArabic ? 'دفع للنظام' : 'Push to system')}
                        </button>
                        {confirmDeleteDelivery === u.id ? (
                          <span className="flex items-center gap-1">
                            <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteDelivery(u.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                            <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDeleteDelivery(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                          </span>
                        ) : (
                          <button type="button" className="text-red-400 hover:text-red-600" onClick={() => setConfirmDeleteDelivery(u.id)} title={isArabic ? 'حذف' : 'Delete'}><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className={`badge-${u.status === 'failed' ? 'red' : 'yellow'}`}>
                          {u.status === 'failed' ? (isArabic ? 'فشل' : 'Failed') : (isArabic ? 'قيد الرفع' : 'Uploading')}
                        </span>
                        {confirmDeleteDelivery === u.id ? (
                          <span className="flex items-center gap-1">
                            <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteDelivery(u.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                            <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDeleteDelivery(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                          </span>
                        ) : (
                          <button type="button" className="text-red-400 hover:text-red-600" onClick={() => setConfirmDeleteDelivery(u.id)} title={isArabic ? 'حذف' : 'Delete'}><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {pushFormFor === u.id && !u.audiobookId && u.status === 'completed' && (
                  <div className="mt-3 ml-7 rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                    <p className="text-xs font-semibold text-[color:var(--samawy-ink)]">{isArabic ? 'بيانات العنوان (يملؤها مدير الاستوديو)' : 'Title metadata (studio manager fills this)'}</p>
                    {/* Publisher */}
                    {pushSeller ? (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 w-fit">
                        <span className="font-semibold">{pushSeller.name} <span className="opacity-70">#{pushSeller.id}</span></span>
                        <button type="button" className="text-emerald-700" onClick={() => setPushSeller(null)}><XCircle className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <input className="input text-xs flex-1" placeholder={isArabic ? 'ابحث عن الناشر…' : 'Search publisher…'} value={sellerQuery} onChange={(e) => setSellerQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPushSellers()} />
                          <button type="button" className="btn-secondary text-xs px-2.5" onClick={searchPushSellers}>{isArabic ? 'بحث' : 'Search'}</button>
                        </div>
                        {sellerResults.length > 0 && (
                          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white max-h-40 overflow-y-auto">
                            {sellerResults.map((s) => (
                              <button key={s.id} type="button" className="w-full text-start px-3 py-1.5 text-xs hover:bg-slate-50" onClick={() => { setPushSeller(s); setSellerResults([]); }}>{s.name} <span className="text-[color:var(--fg-2)]">#{s.id}</span></button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input className="input text-xs" placeholder={isArabic ? 'العنوان *' : 'Title *'} value={metaDraft.title} onChange={(e) => setMetaDraft((d) => ({ ...d, title: e.target.value }))} />
                      <input className="input text-xs" placeholder={isArabic ? 'المؤلف' : 'Author'} value={metaDraft.author} onChange={(e) => setMetaDraft((d) => ({ ...d, author: e.target.value }))} />
                      <input className="input text-xs" placeholder={isArabic ? 'الراوي' : 'Narrator'} value={metaDraft.narrator} onChange={(e) => setMetaDraft((d) => ({ ...d, narrator: e.target.value }))} />
                      <input className="input text-xs font-mono" placeholder="ISBN" value={metaDraft.isbn} onChange={(e) => setMetaDraft((d) => ({ ...d, isbn: e.target.value }))} />
                      {genresData?.genres?.length ? (
                        <select className="input text-xs" value={metaDraft.genre} onChange={(e) => setMetaDraft((d) => ({ ...d, genre: e.target.value }))}>
                          <option value="">{isArabic ? 'النوع' : 'Genre'}</option>
                          {genresData.genres.map((g) => <option key={`${g.id ?? g.name}`} value={g.name}>{g.name}</option>)}
                        </select>
                      ) : (
                        <input className="input text-xs" placeholder={isArabic ? 'النوع' : 'Genre'} value={metaDraft.genre} onChange={(e) => setMetaDraft((d) => ({ ...d, genre: e.target.value }))} />
                      )}
                      <input className="input text-xs" placeholder={isArabic ? 'سنة النشر' : 'Pub year'} value={metaDraft.pubYear} onChange={(e) => setMetaDraft((d) => ({ ...d, pubYear: e.target.value }))} />
                      <select className="input text-xs" value={metaDraft.sellingType} onChange={(e) => setMetaDraft((d) => ({ ...d, sellingType: e.target.value }))}>
                        <option value="">{isArabic ? 'نوع البيع' : 'Selling type'}</option>
                        <option value="subscription">{isArabic ? 'اشتراك' : 'Subscription'}</option>
                        <option value="a_la_carte">{isArabic ? 'شراء منفرد' : 'A la carte'}</option>
                      </select>
                      <input className="input text-xs" type="number" min="0" step="0.01" placeholder={isArabic ? 'السعر' : 'Price'} value={metaDraft.price} onChange={(e) => setMetaDraft((d) => ({ ...d, price: e.target.value }))} />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" className="btn-secondary text-xs py-1 px-2.5" onClick={() => setPushFormFor(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                      <button type="button" className="btn-primary text-xs py-1 px-2.5 disabled:opacity-50" disabled={!pushSeller || !metaDraft.title.trim() || pushingDelivery === u.id} onClick={() => submitPushForm(u.id)}>
                        <Upload className="h-3.5 w-3.5" />{isArabic ? 'إنشاء ودفع' : 'Create & push'}
                      </button>
                    </div>
                  </div>
                )}
                {editingHours === u.id ? (
                  <div className="mt-1.5 ml-7 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-[10px] text-[color:var(--fg-2)] mb-0.5">{isArabic ? 'ساعات صافية' : 'Net hours'}</label>
                      <input className="input text-xs w-24" type="number" min="0" step="0.1" value={hoursDraft} onChange={(e) => setHoursDraft(e.target.value)} placeholder="0" autoFocus />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-[10px] text-[color:var(--fg-2)] mb-0.5">{isArabic ? 'ملاحظات' : 'Notes'}</label>
                      <input className="input text-xs w-full" value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder={isArabic ? 'اختياري' : 'Optional'} />
                    </div>
                    <button type="button" className="btn-primary text-xs py-1 px-2.5 disabled:opacity-50" disabled={savingHours === u.id} onClick={() => saveDeliveryHours(u.id)}>{isArabic ? 'حفظ' : 'Save'}</button>
                    <button type="button" className="text-xs text-slate-500" onClick={() => setEditingHours(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                  </div>
                ) : (
                  <div className="mt-1.5 ml-7 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--fg-2)]">
                    {u.netFinalHours != null
                      ? <span>{isArabic ? 'ساعات صافية:' : 'Net hours:'} <strong className="text-[color:var(--samawy-ink)]">{u.netFinalHours} h</strong></span>
                      : <span className="text-amber-600">{isArabic ? 'لا ساعات صافية' : 'No net hours'}</span>}
                    {cost != null && <span className="text-emerald-700 font-semibold">${cost.toFixed(2)}</span>}
                    {u.notes && <span className="italic">“{u.notes}”</span>}
                    <button type="button" className="inline-flex items-center gap-1 text-[color:var(--samawy-blue)] hover:underline" onClick={() => { setEditingHours(u.id); setHoursDraft(u.netFinalHours != null ? String(u.netFinalHours) : ''); setNotesDraft(u.notes ?? ''); }}>
                      <Pencil className="h-3 w-3" />{isArabic ? 'تعديل الساعات' : 'Edit hours'}
                    </button>
                  </div>
                )}
                </div>
                );
              })}
            </div>
          )}

          {/* Legacy productions (imported history) */}
          {legacyProductions.length > 0 && (
            <div className="card">
              <p className="text-sm font-semibold mb-2">{isArabic ? 'إنتاج تاريخي مستورد' : 'Imported legacy productions'} <span className="text-xs font-normal text-[color:var(--fg-2)]">({legacyProductions.length})</span></p>
              <div className="divide-y divide-slate-100">
                {legacyProductions.map((p) => {
                  const cost = studio?.hourlyRateUsd != null && p.netHours != null ? studio.hourlyRateUsd * p.netHours : null;
                  if (editingProd === p.id) {
                    return (
                      <div key={p.id} className="py-3 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input className="input text-sm" value={prodDraft.bookTitle} onChange={(e) => setProdDraft((d) => ({ ...d, bookTitle: e.target.value }))} placeholder={isArabic ? 'عنوان الكتاب' : 'Book title'} />
                          <input className="input text-sm" value={prodDraft.narrator} onChange={(e) => setProdDraft((d) => ({ ...d, narrator: e.target.value }))} placeholder={isArabic ? 'الراوي' : 'Narrator'} />
                          <input className="input text-sm font-mono" value={prodDraft.isbn} onChange={(e) => setProdDraft((d) => ({ ...d, isbn: e.target.value }))} placeholder="ISBN" />
                          <input className="input text-sm" type="number" min="0" step="0.1" value={prodDraft.netHours} onChange={(e) => setProdDraft((d) => ({ ...d, netHours: e.target.value }))} placeholder={isArabic ? 'ساعات صافية' : 'Net hours'} />
                          <input className="input text-sm sm:col-span-2" value={prodDraft.notes} onChange={(e) => setProdDraft((d) => ({ ...d, notes: e.target.value }))} placeholder={isArabic ? 'ملاحظات' : 'Notes'} />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" className="btn-secondary text-xs py-1 px-2.5" onClick={() => setEditingProd(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                          <button type="button" className="btn-primary text-xs py-1 px-2.5" disabled={!prodDraft.bookTitle.trim()} onClick={() => saveProd(p.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />{isArabic ? 'حفظ' : 'Save'}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.bookTitle}</p>
                        <p className="text-xs text-[color:var(--fg-2)]">{[p.narrator, p.isbn].filter(Boolean).join(' · ') || '—'}{p.notes ? ` · ${p.notes}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0 text-xs">
                        {p.netHours != null && <span>{p.netHours} h</span>}
                        {cost != null && <span className="text-emerald-700 font-semibold">${cost.toFixed(2)}</span>}
                        <button type="button" className="text-slate-400 hover:text-[color:var(--samawy-blue)]" onClick={() => startEditProd(p)} title={isArabic ? 'تعديل' : 'Edit'}><Pencil className="h-3.5 w-3.5" /></button>
                        {confirmDeleteProd === p.id ? (
                          <span className="flex items-center gap-1">
                            <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteProd(p.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                            <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDeleteProd(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                          </span>
                        ) : (
                          <button type="button" className="text-red-400 hover:text-red-600" onClick={() => setConfirmDeleteProd(p.id)} title={isArabic ? 'حذف' : 'Delete'}><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit log tab */}
      {activeTab === 'audit' && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{isArabic ? 'سجل النشاط' : 'Activity log'} <span className="text-xs font-normal text-[color:var(--fg-2)]">({auditData?.events.length ?? 0})</span></p>
            <button type="button" className="btn-secondary text-xs py-1 px-2.5" onClick={() => refetchAudit()}>{isArabic ? 'تحديث' : 'Refresh'}</button>
          </div>
          {!auditData || auditData.events.length === 0 ? (
            <p className="text-sm text-center text-[color:var(--fg-2)] py-6">{isArabic ? 'لا يوجد نشاط مسجّل بعد.' : 'No recorded activity yet.'}</p>
          ) : (
            <div className="relative ps-4">
              <div className="absolute top-1 bottom-1 start-[5px] w-px bg-slate-100" />
              <div className="space-y-3">
                {auditData.events.map((ev) => {
                  const a = auditMeta(ev.action, isArabic);
                  const detail = auditDetailText(ev, isArabic);
                  return (
                    <div key={ev.id} className="relative flex items-start gap-3">
                      <div className={`relative z-10 mt-0.5 h-3 w-3 rounded-full ring-2 ring-white shrink-0 ${a.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-[color:var(--samawy-ink)]">{a.label}</span>
                          {detail && <span className="text-xs text-[color:var(--fg-2)] truncate">— {detail}</span>}
                        </div>
                        <p className="text-[11px] text-[color:var(--fg-2)]">{ev.actor} · {new Date(ev.createdAt).toLocaleString(isArabic ? 'ar-EG' : 'en-US')}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function auditMeta(action: string, isArabic: boolean): { label: string; dot: string } {
  const map: Record<string, { ar: string; en: string; dot: string }> = {
    'studio.login':                  { ar: 'تسجيل دخول', en: 'Signed in', dot: 'bg-emerald-500' },
    'studio.viewed':                 { ar: 'فتح البوابة', en: 'Viewed portal', dot: 'bg-slate-300' },
    'studio.password_changed':       { ar: 'غيّر كلمة المرور', en: 'Changed password', dot: 'bg-amber-500' },
    'asset.downloaded':              { ar: 'نزّل ملفاً مرجعياً', en: 'Downloaded a reference file', dot: 'bg-blue-400' },
    'production_file.downloaded':    { ar: 'نزّل ملف إنتاج', en: 'Downloaded a production file', dot: 'bg-blue-400' },
    'production_file.uploaded':      { ar: 'رفع ملف إنتاج', en: 'Production file uploaded', dot: 'bg-violet-500' },
    'production_file.plan_submitted':{ ar: 'أرسل خطة الإنتاج', en: 'Submitted production plan', dot: 'bg-violet-500' },
    'production_file.status_changed':{ ar: 'غيّر حالة الكتاب', en: 'Changed book status', dot: 'bg-blue-500' },
    'production_file.assigned':      { ar: 'رُبط بعنوان', en: 'Linked to a title', dot: 'bg-blue-500' },
    'production_file.unassigned':    { ar: 'أُلغي الربط', en: 'Unlinked from title', dot: 'bg-slate-400' },
    'sample.uploaded':              { ar: 'رفع عينة', en: 'Uploaded a sample', dot: 'bg-amber-500' },
    'sample.reviewed':              { ar: 'تمت مراجعة عينة', en: 'Sample reviewed', dot: 'bg-emerald-500' },
    'sample.deleted':               { ar: 'حُذفت عينة', en: 'Sample deleted', dot: 'bg-red-500' },
    'delivery.uploaded':            { ar: 'رفع تسليماً', en: 'Uploaded a delivery', dot: 'bg-emerald-600' },
    'delivery.meta_edited':         { ar: 'عدّل ساعات/ملاحظات التسليم', en: 'Edited delivery hours/notes', dot: 'bg-amber-500' },
    'delivery.received':            { ar: 'تم استلام تسليم', en: 'Delivery received', dot: 'bg-emerald-600' },
    'delivery.pushed':              { ar: 'دُفع التسليم للنظام', en: 'Delivery pushed to system', dot: 'bg-violet-600' },
    'delivery.deleted':             { ar: 'حُذف تسليم', en: 'Delivery deleted', dot: 'bg-red-500' },
    'legacy.imported':             { ar: 'استيراد تاريخي', en: 'Legacy import', dot: 'bg-slate-400' },
  };
  const m = map[action];
  return { label: m ? (isArabic ? m.ar : m.en) : action, dot: m?.dot ?? 'bg-slate-400' };
}

function auditDetailText(ev: AuditEvent, isArabic: boolean): string {
  const d = ev.detail ?? {};
  const pick = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined);
  const name = pick('name') || pick('title') || pick('fileName') || pick('objectKey');
  if (ev.action === 'production_file.status_changed') {
    const st = pick('status');
    const stLabel = st === 'in_production' ? (isArabic ? 'قيد الإنتاج' : 'In Production') : st === 'delivered' ? (isArabic ? 'تم التسليم' : 'Delivered') : (isArabic ? 'قائمة الانتظار' : 'Backlog');
    return [name, stLabel].filter(Boolean).join(' → ');
  }
  if (ev.action === 'sample.reviewed') {
    const st = pick('status');
    return [name, st === 'approved' ? (isArabic ? 'موافقة' : 'Approved') : (isArabic ? 'مرفوضة' : 'Refused')].filter(Boolean).join(' — ');
  }
  if (ev.action === 'delivery.meta_edited') {
    const from = (d.from ?? {}) as { netFinalHours?: number | null; notes?: string | null };
    const to = (d.to ?? {}) as { netFinalHours?: number | null; notes?: string | null };
    const h = (from.netFinalHours ?? '—') !== (to.netFinalHours ?? '—') ? `${isArabic ? 'ساعات' : 'hrs'}: ${from.netFinalHours ?? '—'} → ${to.netFinalHours ?? '—'}` : '';
    const n = (from.notes ?? '') !== (to.notes ?? '') ? (isArabic ? 'تغيّرت الملاحظات' : 'notes changed') : '';
    return [name, [h, n].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  }
  return name ?? '';
}
