import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Plus, Trash2, Send, Settings2, Mail, Users,
  Music, CloudUpload, DollarSign, Clock, LibraryBig, AlertCircle,
} from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { InlineError } from '../components/InlineError';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { StudiosResponse, StudioWithStats, AcquisitionUser } from '@api';

interface AcquisitionUsersResponse { users: AcquisitionUser[] }

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
  const { addToast } = useToast();
  const { isArabic } = useLocale();

  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', slug: '', contactEmail: '' });
  const [creating, setCreating] = useState(false);
  const [sendingLink, setSendingLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showAcqForm, setShowAcqForm] = useState(false);
  const [acqForm, setAcqForm] = useState({ email: '', name: '' });
  const [creatingAcq, setCreatingAcq] = useState(false);
  const [sendingAcqLink, setSendingAcqLink] = useState<string | null>(null);

  async function createStudio() {
    if (!newForm.name || !newForm.slug || !newForm.contactEmail) {
      addToast(isArabic ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields', 'error');
      return;
    }
    setCreating(true);
    try {
      await apiRequest('/api/studios', { method: 'POST', body: { name: newForm.name, slug: newForm.slug, contactEmail: newForm.contactEmail } });
      addToast(isArabic ? 'تم إنشاء الاستوديو.' : 'Studio created.', 'success');
      setNewForm({ name: '', slug: '', contactEmail: '' });
      setShowNewForm(false);
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإنشاء' : 'Failed to create'), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function sendLink(studioId: string) {
    setSendingLink(studioId);
    try {
      await apiRequest(`/api/studios/${studioId}/magic-link`, { method: 'POST' });
      addToast(isArabic ? 'تم إرسال رابط الدخول.' : 'Magic link sent.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإرسال' : 'Failed to send'), 'error');
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
    setCreatingAcq(true);
    try {
      await apiRequest('/api/studios/acquisition-users', { method: 'POST', body: { email: acqForm.email, name: acqForm.name } });
      addToast(isArabic ? 'تم إنشاء حساب الاقتناء.' : 'Acquisition user created.', 'success');
      setAcqForm({ email: '', name: '' });
      setShowAcqForm(false);
      refetchAcq();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإنشاء' : 'Failed'), 'error');
    } finally {
      setCreatingAcq(false);
    }
  }

  async function sendAcqLink(id: string) {
    setSendingAcqLink(id);
    try {
      await apiRequest(`/api/studios/acquisition-users/${id}/magic-link`, { method: 'POST' });
      addToast(isArabic ? 'تم إرسال رابط الدخول.' : 'Magic link sent.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الإرسال' : 'Failed'), 'error');
    } finally {
      setSendingAcqLink(null);
    }
  }

  if (loading) return <div className="card text-sm text-center text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  if (error) return <InlineError message={error} detail={errorDetail ?? undefined} />;

  const studios = data?.studios ?? [];
  const summary = data?.summary;
  const acqUsers = acqData?.users ?? [];
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
                    <button type="button" className="btn-secondary text-xs py-1 px-2.5" disabled={sendingLink === s.id} onClick={() => sendLink(s.id)} title={isArabic ? 'إرسال رابط الدخول' : 'Send magic link'}>
                      <Send className="h-3 w-3" />
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
                <button type="button" className="btn-secondary text-xs py-1 px-2.5" disabled={sendingAcqLink === u.id} onClick={() => sendAcqLink(u.id)} title={isArabic ? 'إرسال رابط الدخول' : 'Send magic link'}>
                  <Send className="h-3 w-3" />
                  {isArabic ? 'إرسال رابط' : 'Send link'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
