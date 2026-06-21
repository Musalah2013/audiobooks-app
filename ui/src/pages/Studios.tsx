import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Trash2, Send, Settings2, Mail } from 'lucide-react';
import { useApi, apiRequest, API_BASE } from '../hooks/useApi';
import { InlineError } from '../components/InlineError';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { Studio, AcquisitionUser } from '@api';

interface StudiosResponse { studios: Studio[] }
interface AcquisitionUsersResponse { users: AcquisitionUser[] }

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function Studios() {
  const { data, loading, error, errorDetail, refetch } = useApi<StudiosResponse>('/api/studios');
  const { data: acqData, refetch: refetchAcq } = useApi<AcquisitionUsersResponse>('/api/studios/acquisition-users');
  const { addToast } = useToast();
  const { isArabic } = useLocale();

  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', slug: '', contactEmail: '', driveFolderId: '' });
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
      await apiRequest('/api/studios', { method: 'POST', body: { name: newForm.name, slug: newForm.slug, contactEmail: newForm.contactEmail, driveFolderId: newForm.driveFolderId || undefined } });
      addToast(isArabic ? 'تم إنشاء الاستوديو.' : 'Studio created.', 'success');
      setNewForm({ name: '', slug: '', contactEmail: '', driveFolderId: '' });
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
  const acqUsers = acqData?.users ?? [];

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
              <h2 className="section-title">{isArabic ? 'الاستوديوهات' : 'Studios'}</h2>
              <p className="section-subtitle">{isArabic ? 'إدارة بوابات شركاء الإنتاج الصوتي.' : 'Manage audiobook production partner portals.'}</p>
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
              <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'معرّف مجلد Drive' : 'Drive Folder ID'}</label>
              <input className="input w-full font-mono text-sm" value={newForm.driveFolderId} onChange={(e) => setNewForm((p) => ({ ...p, driveFolderId: e.target.value }))} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs" />
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowNewForm(false)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn-primary" disabled={creating} onClick={createStudio}>{creating ? (isArabic ? 'جاري الإنشاء…' : 'Creating…') : (isArabic ? 'إنشاء' : 'Create')}</button>
            </div>
          </div>
        )}
      </section>

      {/* Studios list */}
      <section className="card space-y-0 p-0 overflow-hidden">
        {studios.length === 0 ? (
          <div className="p-8 text-center text-sm text-[color:var(--fg-2)]">
            <Building2 className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            {isArabic ? 'لا توجد استوديوهات بعد.' : 'No studios yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-start py-3 px-4 font-medium text-[color:var(--fg-2)]">{isArabic ? 'الاستوديو' : 'Studio'}</th>
                  <th className="text-start py-3 px-4 font-medium text-[color:var(--fg-2)]">{isArabic ? 'الرابط' : 'Slug'}</th>
                  <th className="text-start py-3 px-4 font-medium text-[color:var(--fg-2)]">{isArabic ? 'البريد' : 'Email'}</th>
                  <th className="text-start py-3 px-4 font-medium text-[color:var(--fg-2)]">{isArabic ? 'الحالة' : 'Status'}</th>
                  <th className="text-end py-3 px-4 font-medium text-[color:var(--fg-2)]">{isArabic ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {studios.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {s.logoObjectKey ? (
                          <img src={`${API_BASE}/api/files/${s.logoObjectKey}?preview=1`} alt="" className="h-8 w-8 rounded-lg object-cover border border-slate-200" />
                        ) : (
                          <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><Building2 className="h-4 w-4" /></div>
                        )}
                        <span className="font-semibold text-[color:var(--samawy-ink)]">{s.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[color:var(--fg-2)]">{s.slug}</td>
                    <td className="py-3 px-4 text-[color:var(--fg-2)]">{s.contactEmail}</td>
                    <td className="py-3 px-4">
                      <span className={`badge-${s.isActive ? 'green' : 'gray'}`}>{s.isActive ? (isArabic ? 'نشط' : 'Active') : (isArabic ? 'معطّل' : 'Inactive')}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" className="btn-secondary text-xs py-1 px-2.5" disabled={sendingLink === s.id} onClick={() => sendLink(s.id)} title={isArabic ? 'إرسال رابط الدخول' : 'Send magic link'}>
                          <Send className="h-3 w-3" />
                        </button>
                        <Link to={`/studios/${s.id}`} className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1" title={isArabic ? 'إدارة' : 'Manage'}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
