import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Plus, Trash2, Settings2, Mail, Users,
  Music, CloudUpload, DollarSign, Clock, LibraryBig, AlertCircle,
  Package, Download, Upload, Pencil, FileText, KeyRound,
} from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { InlineError } from '../components/InlineError';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { StudiosResponse, StudioWithStats, AcquisitionUser, SharedAsset } from '@api';

interface AcquisitionUsersResponse { users: AcquisitionUser[] }
interface SharedAssetsResponse { assets: SharedAsset[] }

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function KPI({ icon: Icon, label, value, sub, tone = 'blue' }: { icon: typeof Building2; label: string; value: string | number; sub?: string; tone?: 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' }) {
  const tones: Record<string, string> = {
    blue: 'bg-[rgba(11,128,255,0.08)] text-[color:var(--samawy-blue)]',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="card flex items-center gap-3">
      <div className={`rounded-2xl p-3 ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-2xl font-black text-[color:var(--samawy-ink)] leading-none">{value}</p>
        <p className="text-xs text-[color:var(--fg-2)] mt-1">{label}</p>
        {sub && <p className="text-[11px] text-[color:var(--fg-2)] opacity-80">{sub}</p>}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: typeof Building2; label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${accent ?? 'text-slate-400'}`} />
      <div className="min-w-0">
        <p className={`text-sm font-bold leading-none ${accent ?? 'text-[color:var(--samawy-ink)]'}`}>{value}</p>
        <p className="text-[10px] text-[color:var(--fg-2)] truncate">{label}</p>
      </div>
    </div>
  );
}

export default function Studios() {
  const { data, loading, error, errorDetail, refetch } = useApi<StudiosResponse>('/api/studios');
  const { data: acqData, refetch: refetchAcq } = useApi<AcquisitionUsersResponse>('/api/studios/acquisition-users');
  const { data: sharedData, refetch: refetchShared } = useApi<SharedAssetsResponse>('/api/studios/shared-assets');
  const { addToast } = useToast();
  const { isArabic } = useLocale();

  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', slug: '', contactEmail: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [sendingLink, setSendingLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showAcqForm, setShowAcqForm] = useState(false);
  const [acqForm, setAcqForm] = useState({ email: '', name: '', password: '' });
  const [creatingAcq, setCreatingAcq] = useState(false);
  const [sendingAcqLink, setSendingAcqLink] = useState<string | null>(null);

  // Shared asset library
  const [assetTargets, setAssetTargets] = useState<string[]>([]); // [] = all studios
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [editingVis, setEditingVis] = useState<string | null>(null);
  const [visDraft, setVisDraft] = useState<string[]>([]);
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<string | null>(null);

  async function createStudio() {
    if (!newForm.name || !newForm.slug || !newForm.contactEmail) {
      addToast(isArabic ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields', 'error');
      return;
    }
    if (newForm.password && newForm.password.length < 8) {
      addToast(isArabic ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters', 'error');
      return;
    }
    setCreating(true);
    try {
      await apiRequest('/api/studios', { method: 'POST', body: { name: newForm.name, slug: newForm.slug, contactEmail: newForm.contactEmail, password: newForm.password || undefined } });
      addToast(isArabic ? 'تم إنشاء الاستوديو.' : 'Studio created.', 'success');
      setNewForm({ name: '', slug: '', contactEmail: '', password: '' });
      setShowNewForm(false);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإنشاء' : 'Failed to create'), 'error');
    } finally {
      setCreating(false);
    }
  }

  // Admin sets/resets the studio's primary contact password.
  async function setStudioPassword(studioId: string) {
    const pw = window.prompt(isArabic ? 'كلمة مرور جديدة لمدير الاستوديو (8 أحرف على الأقل):' : 'New password for the studio primary contact (min 8 chars):');
    if (pw == null) return;
    if (pw.length < 8) { addToast(isArabic ? 'كلمة المرور قصيرة جداً' : 'Password too short', 'error'); return; }
    setSendingLink(studioId);
    try {
      await apiRequest(`/api/studios/${studioId}/set-password`, { method: 'POST', body: { password: pw } });
      addToast(isArabic ? 'تم تعيين كلمة المرور.' : 'Password set.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل التعيين' : 'Failed to set'), 'error');
    } finally {
      setSendingLink(null);
    }
  }

  async function deleteStudio(id: string) {
    setDeleting(true);
    try {
      await apiRequest(`/api/studios/${id}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف الاستوديو.' : 'Studio deleted.', 'success');
      setConfirmDelete(null);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Failed to delete'), 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function createAcqUser() {
    if (!acqForm.email || !acqForm.name) return;
    if (!acqForm.password || acqForm.password.length < 8) {
      addToast(isArabic ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters', 'error');
      return;
    }
    setCreatingAcq(true);
    try {
      await apiRequest('/api/studios/acquisition-users', { method: 'POST', body: { email: acqForm.email, name: acqForm.name, password: acqForm.password } });
      addToast(isArabic ? 'تم إنشاء حساب الاقتناء.' : 'Acquisition user created.', 'success');
      setAcqForm({ email: '', name: '', password: '' });
      setShowAcqForm(false);
      refetchAcq();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإنشاء' : 'Failed'), 'error');
    } finally {
      setCreatingAcq(false);
    }
  }

  // Admin sets/resets an acquisition member's password.
  async function setAcqPassword(id: string) {
    const pw = window.prompt(isArabic ? 'كلمة مرور جديدة (8 أحرف على الأقل):' : 'New password (min 8 chars):');
    if (pw == null) return;
    if (pw.length < 8) { addToast(isArabic ? 'كلمة المرور قصيرة جداً' : 'Password too short', 'error'); return; }
    setSendingAcqLink(id);
    try {
      await apiRequest(`/api/studios/acquisition-users/${id}/set-password`, { method: 'POST', body: { password: pw } });
      addToast(isArabic ? 'تم تعيين كلمة المرور.' : 'Password set.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل التعيين' : 'Failed'), 'error');
    } finally {
      setSendingAcqLink(null);
    }
  }

  async function uploadSharedAsset(file: File) {
    setUploadingAsset(true);
    try {
      const { uploadUrl, objectKey } = await apiRequest<{ uploadUrl: string; objectKey: string }>('/api/studios/shared-assets/upload-url', { method: 'POST', body: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
      const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await apiRequest('/api/studios/shared-assets/complete', { method: 'POST', body: { objectKey, fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size, studioIds: assetTargets } });
      addToast(isArabic ? 'تمت إضافة الملف.' : 'Asset added.', 'success');
      setAssetTargets([]);
      refetchShared();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الرفع' : 'Upload failed'), 'error');
    } finally { setUploadingAsset(false); }
  }

  async function saveVisibility(assetId: string) {
    try {
      await apiRequest(`/api/studios/shared-assets/${assetId}/visibility`, { method: 'PATCH', body: { studioIds: visDraft } });
      addToast(isArabic ? 'تم تحديث الظهور.' : 'Visibility updated.', 'success');
      setEditingVis(null);
      refetchShared();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحفظ' : 'Failed to save'), 'error');
    }
  }

  async function deleteSharedAsset(assetId: string) {
    try {
      await apiRequest(`/api/studios/shared-assets/${assetId}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف الملف.' : 'Asset deleted.', 'success');
      setConfirmDeleteAsset(null);
      refetchShared();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    }
  }

  if (loading) return <div className="card text-sm text-center text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  if (error) return <InlineError message={error} detail={errorDetail ?? undefined} />;

  const studios = data?.studios ?? [];
  const summary = data?.summary;
  const acqUsers = acqData?.users ?? [];
  const sharedAssets = sharedData?.assets ?? [];
  const studioNameById = new Map(studios.map((s) => [s.id, s.name]));
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const sampleTotal = (summary?.samplesPending ?? 0) + (summary?.samplesApproved ?? 0) + (summary?.samplesRefused ?? 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="card">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[rgba(11,128,255,0.08)] p-3 text-[color:var(--samawy-blue)]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="section-title">{isArabic ? 'لوحة الاستوديوهات' : 'Studios dashboard'}</h2>
              <p className="section-subtitle">{isArabic ? 'تحليلات شركاء الإنتاج الصوتي والعينات والتسليمات والتكلفة.' : 'Analytics across production partners — samples, deliveries, and billing.'}</p>
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={() => setShowNewForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            {isArabic ? 'استوديو جديد' : 'New Studio'}
          </button>
        </div>

        {showNewForm && (
          <div className="mt-6 border-t border-slate-100 pt-5 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'الاسم *' : 'Name *'}</label>
              <input className="input w-full" value={newForm.name} onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value, slug: slugify(e.target.value) }))} placeholder={isArabic ? 'دار الكتاب' : 'Dar Al-Kitab'} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'الرابط (slug) *' : 'Slug *'}</label>
              <input className="input w-full font-mono text-sm" value={newForm.slug} onChange={(e) => setNewForm((p) => ({ ...p, slug: e.target.value }))} placeholder="dar-al-kitab" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'البريد الإلكتروني *' : 'Contact Email *'}</label>
              <input className="input w-full" type="email" value={newForm.contactEmail} onChange={(e) => setNewForm((p) => ({ ...p, contactEmail: e.target.value }))} placeholder="studio@example.com" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'كلمة المرور (للدخول)' : 'Password (for login)'}</label>
              <input className="input w-full" type="password" value={newForm.password} onChange={(e) => setNewForm((p) => ({ ...p, password: e.target.value }))} placeholder={isArabic ? '8 أحرف على الأقل' : 'min 8 characters'} autoComplete="new-password" />
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowNewForm(false)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn-primary" disabled={creating} onClick={createStudio}>{creating ? (isArabic ? 'جاري الإنشاء…' : 'Creating…') : (isArabic ? 'إنشاء' : 'Create')}</button>
            </div>
          </div>
        )}
      </section>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KPI icon={Building2} tone="blue" label={isArabic ? 'الاستوديوهات' : 'Studios'} value={summary?.totalStudios ?? 0} sub={`${summary?.activeStudios ?? 0} ${isArabic ? 'نشط' : 'active'}`} />
        <KPI icon={Users} tone="violet" label={isArabic ? 'مستخدمو الاستوديوهات' : 'Studio users'} value={summary?.totalUsers ?? 0} />
        <KPI icon={LibraryBig} tone="blue" label={isArabic ? 'ملفات الإنتاج' : 'Production files'} value={summary?.totalProductionFiles ?? 0} sub={`${summary?.totalAssigned ?? 0} ${isArabic ? 'مُسنَد' : 'assigned'}`} />
        <KPI icon={Music} tone="amber" label={isArabic ? 'عينات بانتظار المراجعة' : 'Samples pending review'} value={summary?.samplesPending ?? 0} />
        <KPI icon={CloudUpload} tone="emerald" label={isArabic ? 'التسليمات' : 'Deliveries'} value={summary?.totalDeliveries ?? 0} sub={`${(summary?.totalNetHours ?? 0).toFixed(1)} ${isArabic ? 'ساعة صافية' : 'net hours'}`} />
        <KPI icon={DollarSign} tone="emerald" label={isArabic ? 'إجمالي التكلفة' : 'Total billing'} value={`$${(summary?.totalCostUsd ?? 0).toFixed(2)}`} />
      </div>

      {/* Samples pipeline */}
      {sampleTotal > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2"><Music className="h-4 w-4 text-amber-500" />{isArabic ? 'حالة العينات' : 'Sample review pipeline'}</h3>
            <span className="text-xs text-[color:var(--fg-2)]">{sampleTotal} {isArabic ? 'عينة' : 'samples'}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-amber-400" style={{ width: `${((summary?.samplesPending ?? 0) / sampleTotal) * 100}%` }} title="pending" />
            <div className="bg-emerald-500" style={{ width: `${((summary?.samplesApproved ?? 0) / sampleTotal) * 100}%` }} title="approved" />
            <div className="bg-rose-500" style={{ width: `${((summary?.samplesRefused ?? 0) / sampleTotal) * 100}%` }} title="refused" />
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />{isArabic ? 'قيد المراجعة' : 'Pending'}: <strong>{summary?.samplesPending ?? 0}</strong></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{isArabic ? 'معتمدة' : 'Approved'}: <strong>{summary?.samplesApproved ?? 0}</strong></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />{isArabic ? 'مرفوضة' : 'Refused'}: <strong>{summary?.samplesRefused ?? 0}</strong></span>
          </div>
        </section>
      )}

      {/* Per-studio analytics cards */}
      <section className="space-y-3">
        <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'الاستوديوهات' : 'Studios'}</h3>
        {studios.length === 0 ? (
          <div className="card p-8 text-center text-sm text-[color:var(--fg-2)]">
            <Building2 className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            {isArabic ? 'لا توجد استوديوهات بعد.' : 'No studios yet.'}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {studios.map((s: StudioWithStats) => (
              <div key={s.id} className="card space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {s.logoObjectKey ? (
                      <img src={`${API_BASE}/api/files/${s.logoObjectKey}?preview=1`} alt="" className="h-11 w-11 rounded-xl object-cover border border-slate-200" />
                    ) : (
                      <div className="h-11 w-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400"><Building2 className="h-5 w-5" /></div>
                    )}
                    <div className="min-w-0">
                      <Link to={`/studios/${s.id}`} className="font-bold text-[color:var(--samawy-ink)] hover:text-[color:var(--samawy-blue)] truncate block">{s.name}</Link>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <code className="font-mono text-[11px] text-[color:var(--fg-2)]">{s.slug}</code>
                        <span className={`badge-${s.isActive ? 'green' : 'gray'} !px-2 !py-0.5 !text-[10px]`}>{s.isActive ? (isArabic ? 'نشط' : 'Active') : (isArabic ? 'معطّل' : 'Inactive')}</span>
                        {s.hourlyRateUsd != null && <span className="text-[11px] text-emerald-700 font-semibold">${s.hourlyRateUsd}/h</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" className="btn-secondary text-xs py-1 px-2.5" disabled={sendingLink === s.id} onClick={() => setStudioPassword(s.id)} title={isArabic ? 'تعيين كلمة المرور' : 'Set password'}>
                      <KeyRound className="h-3 w-3" />
                    </button>
                    <Link to={`/studios/${s.id}`} className="btn-secondary text-xs py-1 px-2.5" title={isArabic ? 'إدارة' : 'Manage'}>
                      <Settings2 className="h-3 w-3" />
                    </Link>
                    {confirmDelete === s.id ? (
                      <div className="flex items-center gap-1">
                        <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" disabled={deleting} onClick={() => deleteStudio(s.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                        <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDelete(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                      </div>
                    ) : (
                      <button type="button" className="text-red-400 hover:text-red-600 p-1 rounded" onClick={() => setConfirmDelete(s.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>

                {s.stats.samplesPending > 0 && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {s.stats.samplesPending} {isArabic ? 'عينة بانتظار مراجعتك' : 'sample(s) awaiting your review'}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <Stat icon={Users} label={isArabic ? 'مستخدمون' : 'Users'} value={s.stats.contacts} />
                  <Stat icon={LibraryBig} label={isArabic ? 'مُسنَد / ملفات' : 'Assigned / files'} value={`${s.stats.assignedFiles}/${s.stats.productionFiles}`} />
                  <Stat icon={Music} label={isArabic ? 'عينات قيد المراجعة' : 'Pending samples'} value={s.stats.samplesPending} accent={s.stats.samplesPending > 0 ? 'text-amber-600' : undefined} />
                  <Stat icon={CloudUpload} label={isArabic ? 'تسليمات' : 'Deliveries'} value={s.stats.deliveries} />
                  <Stat icon={Clock} label={isArabic ? 'ساعات صافية' : 'Net hours'} value={s.stats.netFinalHours.toFixed(1)} />
                  <Stat icon={DollarSign} label={isArabic ? 'التكلفة' : 'Cost'} value={s.stats.costUsd != null ? `$${s.stats.costUsd.toFixed(2)}` : '—'} accent={s.stats.costUsd != null ? 'text-emerald-700' : undefined} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Acquisition users */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-[color:var(--samawy-blue)]" />
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'فريق الاقتناء' : 'Acquisition Users'}</h3>
          </div>
          <button type="button" className="btn-secondary text-xs py-1.5 px-3" onClick={() => setShowAcqForm((v) => !v)}>
            <Plus className="h-3.5 w-3.5" />
            {isArabic ? 'إضافة' : 'Add'}
          </button>
        </div>

        {showAcqForm && (
          <div className="border border-slate-200 rounded-[14px] p-4 grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'الاسم *' : 'Name *'}</label>
              <input className="input w-full" value={acqForm.name} onChange={(e) => setAcqForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'البريد *' : 'Email *'}</label>
              <input className="input w-full" type="email" value={acqForm.email} onChange={(e) => setAcqForm((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'كلمة المرور *' : 'Password *'}</label>
              <input className="input w-full" type="password" value={acqForm.password} onChange={(e) => setAcqForm((p) => ({ ...p, password: e.target.value }))} placeholder={isArabic ? '8 أحرف على الأقل' : 'min 8 characters'} autoComplete="new-password" />
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" className="btn-secondary text-xs py-1.5 px-3" onClick={() => setShowAcqForm(false)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn-primary text-xs py-1.5 px-3" disabled={creatingAcq} onClick={createAcqUser}>{isArabic ? 'إنشاء' : 'Create'}</button>
            </div>
          </div>
        )}

        {acqUsers.length === 0 ? (
          <p className="text-sm text-[color:var(--fg-2)]">{isArabic ? 'لا يوجد أعضاء في فريق الاقتناء.' : 'No acquisition users yet.'}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {acqUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2.5 gap-3">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--samawy-ink)]">{u.name}</p>
                  <p className="text-xs text-[color:var(--fg-2)]">{u.email}</p>
                </div>
                <button type="button" className="btn-secondary text-xs py-1 px-2.5" disabled={sendingAcqLink === u.id} onClick={() => setAcqPassword(u.id)} title={isArabic ? 'تعيين كلمة المرور' : 'Set password'}>
                  <KeyRound className="h-3 w-3" />
                  {isArabic ? 'كلمة المرور' : 'Set password'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Shared asset library */}
      <section className="card space-y-4">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-[color:var(--samawy-blue)]" />
          <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'مكتبة الملفات المشتركة' : 'Shared Asset Library'}</h3>
        </div>
        <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'ارفع ملفاً مرجعياً مرة واحدة وحدّد أي الاستوديوهات تراه. بدون تحديد = يظهر لجميع الاستوديوهات.' : 'Upload a reference file once and choose which studios see it. No selection = visible to all studios.'}</p>

        {/* Upload + target picker */}
        <div className="border border-slate-200 rounded-[14px] p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1.5 block">{isArabic ? 'مرئي للاستوديوهات' : 'Visible to studios'} <span className="font-normal opacity-70">({assetTargets.length === 0 ? (isArabic ? 'الكل' : 'all') : assetTargets.length})</span></label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {studios.map((s) => {
                const on = assetTargets.includes(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => setAssetTargets((l) => toggleIn(l, s.id))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-[color:var(--samawy-blue)] text-white border-[color:var(--samawy-blue)]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                    {s.name}
                  </button>
                );
              })}
            </div>
            {assetTargets.length === 0 && <p className="text-[11px] text-emerald-600 mt-1.5">{isArabic ? 'سيظهر لجميع الاستوديوهات.' : 'Will be visible to all studios.'}</p>}
          </div>
          <label className={`btn-primary text-xs py-1.5 px-3 inline-flex cursor-pointer ${uploadingAsset ? 'opacity-50 pointer-events-none' : ''}`}>
            <Upload className="h-3.5 w-3.5" />{uploadingAsset ? (isArabic ? 'جاري الرفع…' : 'Uploading…') : (isArabic ? 'رفع ملف' : 'Upload file')}
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSharedAsset(f); e.target.value = ''; }} />
          </label>
        </div>

        {/* Asset list */}
        {sharedAssets.length === 0 ? (
          <p className="text-sm text-[color:var(--fg-2)]">{isArabic ? 'لا توجد ملفات مشتركة بعد.' : 'No shared assets yet.'}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {sharedAssets.map((a) => (
              <div key={a.id} className="py-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-[color:var(--samawy-blue)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[color:var(--samawy-ink)] truncate">{a.name}</p>
                    <p className="text-xs text-[color:var(--fg-2)]">{formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}</p>
                  </div>
                  <a href={`${API_BASE}/api/files/${a.objectKey}?_dl=1`} download className="btn-secondary text-xs py-1 px-2"><Download className="h-3.5 w-3.5" /></a>
                  <button type="button" className="text-slate-400 hover:text-[color:var(--samawy-blue)] p-1" onClick={() => { setEditingVis(a.id); setVisDraft(a.studioIds); }} title={isArabic ? 'تعديل الظهور' : 'Edit visibility'}><Pencil className="h-3.5 w-3.5" /></button>
                  {confirmDeleteAsset === a.id ? (
                    <span className="flex items-center gap-1">
                      <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white" onClick={() => deleteSharedAsset(a.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                      <button type="button" className="text-[10px] text-slate-500" onClick={() => setConfirmDeleteAsset(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                    </span>
                  ) : (
                    <button type="button" className="text-red-400 hover:text-red-600 p-1" onClick={() => setConfirmDeleteAsset(a.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
                {/* Visibility */}
                <div className="mt-2 ml-7">
                  {editingVis === a.id ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {studios.map((s) => {
                          const on = visDraft.includes(s.id);
                          return (
                            <button key={s.id} type="button" onClick={() => setVisDraft((l) => toggleIn(l, s.id))}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-[color:var(--samawy-blue)] text-white border-[color:var(--samawy-blue)]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[color:var(--fg-2)]">{visDraft.length === 0 ? (isArabic ? 'الكل' : 'All studios') : `${visDraft.length} ${isArabic ? 'استوديو' : 'studios'}`}</span>
                        <button type="button" className="btn-primary text-xs py-1 px-2.5" onClick={() => saveVisibility(a.id)}>{isArabic ? 'حفظ' : 'Save'}</button>
                        <button type="button" className="text-xs text-slate-500" onClick={() => setEditingVis(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--fg-2)]">
                      <span className="font-semibold">{isArabic ? 'مرئي لـ:' : 'Visible to:'}</span>
                      {a.studioIds.length === 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">{isArabic ? 'جميع الاستوديوهات' : 'All studios'}</span>
                      ) : (
                        a.studioIds.map((sid) => <span key={sid} className="px-2 py-0.5 rounded-full bg-slate-100">{studioNameById.get(sid) ?? sid}</span>)
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
