import { useState } from 'react';
import { AlertCircle, KeyRound, Plus, Shield, Trash2, UserCheck, UserX } from 'lucide-react';
import { apiRequest, useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { UserPermission, MeResponse, UsersResponse } from '@api';
import { ALL_PERMISSIONS } from '@api';

const PERMISSION_META: Record<UserPermission, { label: string; labelAr: string; desc: string; descAr: string }> = {
  intake:     { label: 'Intake',      labelAr: 'الاستيراد',   desc: 'Create and manage batch intake',          descAr: 'إنشاء دفعات الاستيراد وإدارتها' },
  metadata:   { label: 'Metadata',    labelAr: 'البيانات',    desc: 'Parse and manage metadata',               descAr: 'تحليل البيانات الوصفية وإدارتها' },
  matching:   { label: 'Matching',    labelAr: 'المطابقة',    desc: 'Reconcile and approve batches',           descAr: 'المطابقة والموافقة على الدفعات' },
  processing: { label: 'Processing',  labelAr: 'المعالجة',    desc: 'Start and manage audio processing',       descAr: 'بدء معالجة الصوت وإدارتها' },
  dossier:    { label: 'Dossier',     labelAr: 'الدوسيه',     desc: 'Finalize dossiers and sync ClickUp',      descAr: 'إنهاء الدوسيهات والمزامنة مع ClickUp' },
  users:      { label: 'Users',       labelAr: 'المستخدمون',  desc: 'Manage users and permissions',            descAr: 'إدارة المستخدمين والصلاحيات' },
  studios:    { label: 'Studios',     labelAr: 'الاستوديوهات', desc: 'Manage studios, deliveries and assets',  descAr: 'إدارة الاستوديوهات والتسليمات والملفات' },
};

function PermissionBadge({ perm }: { perm: UserPermission }) {
  const colors: Record<UserPermission, string> = {
    intake: 'bg-sky-50 text-sky-700 border-sky-200',
    metadata: 'bg-violet-50 text-violet-700 border-violet-200',
    matching: 'bg-amber-50 text-amber-700 border-amber-200',
    processing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dossier: 'bg-orange-50 text-orange-700 border-orange-200',
    users: 'bg-blue-50 text-blue-700 border-blue-200',
    studios: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[perm]}`}>
      {PERMISSION_META[perm].label}
    </span>
  );
}

function PermissionPicker({
  value,
  onChange,
  disabled,
  isArabic,
}: {
  value: UserPermission[];
  onChange: (v: UserPermission[]) => void;
  disabled?: boolean;
  isArabic: boolean;
}) {
  function toggle(perm: UserPermission) {
    onChange(value.includes(perm) ? value.filter((p) => p !== perm) : [...value, perm]);
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {ALL_PERMISSIONS.map((perm) => {
        const meta = PERMISSION_META[perm];
        const checked = value.includes(perm);
        return (
          <label
            key={perm}
            className={`flex cursor-pointer items-start gap-2.5 rounded-[14px] border p-3 transition-colors ${
              checked ? 'border-[color:var(--samawy-blue)] bg-[rgba(11,128,255,0.05)]' : 'border-slate-200 bg-white hover:border-slate-300'
            } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-[color:var(--samawy-blue)]"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(perm)}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--samawy-ink)]">
                {isArabic ? meta.labelAr : meta.label}
              </p>
              <p className="text-xs text-[color:var(--fg-2)] leading-tight mt-0.5">
                {isArabic ? meta.descAr : meta.desc}
              </p>
            </div>
          </label>
        );
      })}
    </div>
  );
}

export default function Users() {
  const { isArabic } = useLocale();
  const { data: meData, loading: meLoading, refetch: refetchMe } = useApi<MeResponse>('/api/auth/me');
  const { data: usersData, loading: usersLoading, error: usersError, refetch: refetchUsers } = useApi<UsersResponse>('/api/auth/users');
  const { addToast } = useToast();

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<UserPermission[]>(['intake', 'metadata', 'matching', 'processing', 'dossier']);
  const [adding, setAdding] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [editPerms, setEditPerms] = useState<Record<string, UserPermission[]>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pwdTarget, setPwdTarget] = useState<string | null>(null);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);

  const me = meData?.user ?? null;
  const canManageUsers = me?.permissions.includes('users') ?? false;
  const users = usersData?.users ?? [];

  async function bootstrap() {
    setBootstrapping(true);
    try {
      await apiRequest('/api/auth/bootstrap', { method: 'POST' });
      addToast(isArabic ? 'تم تسجيلك كمسؤول.' : 'You are now registered as admin.', 'success');
      refetchMe();
      refetchUsers();
    } catch (err) {
      addToast(err instanceof Error ? err : 'Bootstrap failed', 'error');
    } finally {
      setBootstrapping(false);
    }
  }

  async function addUser() {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await apiRequest('/api/auth/users', {
        method: 'POST',
        body: { email: newEmail.trim(), name: newName.trim() || undefined, permissions: newPerms },
      });
      addToast(`${newEmail.trim()} ${isArabic ? 'تمت إضافته.' : 'added.'}`, 'success');
      setNewEmail('');
      setNewName('');
      setNewPerms(['intake', 'metadata', 'matching', 'processing', 'dossier']);
      refetchUsers();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل إضافة المستخدم' : 'Failed to add user'), 'error');
    } finally {
      setAdding(false);
    }
  }

  async function savePermissions(email: string) {
    const perms = editPerms[email];
    if (!perms) return;
    setActionLoading(email + ':perms');
    try {
      await apiRequest(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'PATCH', body: { permissions: perms } });
      addToast(isArabic ? 'تم حفظ الصلاحيات.' : 'Permissions saved.', 'success');
      setEditPerms((prev) => { const next = { ...prev }; delete next[email]; return next; });
      refetchUsers();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل حفظ الصلاحيات' : 'Failed to save permissions'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function setPassword(targetEmail: string) {
    if (pwdInput.length < 8) { addToast(isArabic ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters', 'error'); return; }
    setPwdSaving(true);
    try {
      await apiRequest('/api/auth/set-password', { method: 'POST', body: { targetEmail, password: pwdInput } });
      addToast(isArabic ? 'تم تعيين كلمة المرور.' : 'Password set.', 'success');
      setPwdTarget(null);
      setPwdInput('');
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل تعيين كلمة المرور' : 'Failed to set password'), 'error');
    } finally {
      setPwdSaving(false);
    }
  }

  async function deleteUser(email: string) {
    setActionLoading(email + ':delete');
    try {
      await apiRequest(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
      addToast(`${email} ${isArabic ? 'تم حذفه.' : 'deleted.'}`, 'success');
      setConfirmDeleteUser(null);
      refetchUsers();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل حذف المستخدم' : 'Failed to delete user'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleActive(email: string, isActive: boolean) {
    setActionLoading(email + ':active');
    try {
      await apiRequest(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'PATCH', body: { isActive } });
      addToast(`${email} ${isActive ? (isArabic ? 'تم تفعيله' : 'activated') : (isArabic ? 'تم تعطيله' : 'deactivated')}.`, 'success');
      refetchUsers();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل تحديث المستخدم' : 'Failed to update user'), 'error');
    } finally {
      setActionLoading(null);
    }
  }

  if (meLoading) {
    return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  }

  if (!me) {
    const noUsers = !usersLoading && users.length === 0;
    return (
      <div className="space-y-6">
        <section className="card">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h2 className="section-title">{isArabic ? 'غير مسجل' : 'Not registered'}</h2>
              <p className="section-subtitle mt-2">
                {isArabic
                  ? 'لم يتم تسجيلك بعد. اطلب من المسؤول إضافتك، أو اضغط أدناه إذا كنت أول مستخدم.'
                  : 'Your account is not registered. Ask an admin to add you, or claim admin if you are the first user.'}
              </p>
              {noUsers && (
                <button className="btn-primary mt-4" onClick={bootstrap} disabled={bootstrapping}>
                  <Shield className="h-4 w-4" />
                  {bootstrapping ? (isArabic ? 'جاري التسجيل…' : 'Registering…') : (isArabic ? 'سجّل كمسؤول (المستخدم الأول)' : 'Claim admin (first user)')}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current user */}
      <section className="card">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[rgba(11,128,255,0.08)] p-3 text-[color:var(--samawy-blue)]">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="section-title">{isArabic ? 'المستخدمون' : 'Users'}</h2>
            <p className="section-subtitle">{isArabic ? 'مسجل بصفتك' : 'Signed in as'} <span className="font-semibold text-[color:var(--samawy-ink)]">{me.email}</span></p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {me.permissions.length === 0
            ? <span className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'لا توجد صلاحيات' : 'No permissions'}</span>
            : me.permissions.map((p) => <PermissionBadge key={p} perm={p} />)}
        </div>
      </section>

      {/* Add user */}
      {canManageUsers && (
        <section className="card space-y-4">
          <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'إضافة مستخدم' : 'Add user'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" type="email" placeholder={isArabic ? 'البريد الإلكتروني *' : 'Email *'} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="input" placeholder={isArabic ? 'الاسم (اختياري)' : 'Name (optional)'} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-3">{isArabic ? 'الصلاحيات' : 'Permissions'}</p>
            <PermissionPicker value={newPerms} onChange={setNewPerms} isArabic={isArabic} />
          </div>
          <button className="btn-primary" onClick={addUser} disabled={adding || !newEmail.trim()}>
            <Plus className="h-4 w-4" />
            {adding ? (isArabic ? 'جاري الإضافة…' : 'Adding…') : (isArabic ? 'إضافة مستخدم' : 'Add user')}
          </button>
        </section>
      )}

      {/* User list */}
      <section className="card space-y-4">
        <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'قائمة المستخدمين' : 'User list'}</h3>
        {usersError && (
          <div className="flex items-center gap-2 rounded-[20px] bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{usersError}
          </div>
        )}
        <div className="space-y-3">
          {users.map((u) => {
            const currentPerms = editPerms[u.email] ?? u.permissions;
            const editing = editPerms[u.email] !== undefined;
            const isSelf = u.email === me.email;
            return (
              <div key={u.email} className={`rounded-[20px] border p-4 space-y-3 ${u.isActive ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-[color:var(--samawy-ink)]">{u.name ?? u.email}</p>
                    {u.name && <p className="font-mono text-xs text-[color:var(--fg-2)]">{u.email}</p>}
                    <span className={`mt-1 inline-block text-xs ${u.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {u.isActive ? (isArabic ? 'نشط' : 'Active') : (isArabic ? 'معطل' : 'Inactive')}
                    </span>
                  </div>
                  {(canManageUsers || isSelf) && (
                    <div className="flex gap-2 flex-wrap">
                      {canManageUsers && !isSelf && (editing ? (
                        <>
                          <button className="btn-primary text-xs px-3 py-1.5" disabled={actionLoading === u.email + ':perms'} onClick={() => savePermissions(u.email)}>
                            {isArabic ? 'حفظ' : 'Save'}
                          </button>
                          <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setEditPerms((prev) => { const next = { ...prev }; delete next[u.email]; return next; })}>
                            {isArabic ? 'إلغاء' : 'Cancel'}
                          </button>
                        </>
                      ) : (
                        <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setEditPerms((prev) => ({ ...prev, [u.email]: [...u.permissions] }))}>
                          {isArabic ? 'تعديل الصلاحيات' : 'Edit permissions'}
                        </button>
                      ))}
                      {canManageUsers && !isSelf && (
                        <button className="btn-secondary text-xs px-3 py-1.5" disabled={actionLoading === u.email + ':active'} onClick={() => toggleActive(u.email, !u.isActive)}>
                          {u.isActive
                            ? <><UserX className="h-3 w-3" />{isArabic ? 'تعطيل' : 'Deactivate'}</>
                            : <><UserCheck className="h-3 w-3" />{isArabic ? 'تفعيل' : 'Activate'}</>}
                        </button>
                      )}
                      {canManageUsers && !isSelf && (
                        confirmDeleteUser === u.email ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-red-700 font-medium">{isArabic ? 'حذف نهائياً؟' : 'Permanently delete?'}</span>
                            <button className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={actionLoading === u.email + ':delete'} onClick={() => deleteUser(u.email)}>
                              {isArabic ? 'نعم' : 'Yes'}
                            </button>
                            <button className="text-xs text-gray-500 hover:text-gray-700" onClick={() => setConfirmDeleteUser(null)}>
                              {isArabic ? 'إلغاء' : 'Cancel'}
                            </button>
                          </div>
                        ) : (
                          <button className="btn-secondary text-xs px-3 py-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirmDeleteUser(u.email)}>
                            <Trash2 className="h-3 w-3" />
                            {isArabic ? 'حذف' : 'Delete'}
                          </button>
                        )
                      )}
                      <button
                        className="btn-secondary text-xs px-3 py-1.5"
                        onClick={() => { setPwdTarget(pwdTarget === u.email ? null : u.email); setPwdInput(''); }}
                        title={isArabic ? 'تعيين كلمة مرور لتسجيل الدخول' : 'Set login password'}
                      >
                        <KeyRound className="h-3 w-3" />
                        {isArabic ? 'تعيين كلمة المرور' : 'Set password'}
                      </button>
                    </div>
                  )}
                </div>

                {pwdTarget === u.email && (
                  <div className="flex gap-2 items-center pt-1">
                    <input
                      type="password"
                      className="input text-sm flex-1"
                      placeholder={isArabic ? 'كلمة مرور جديدة (8 أحرف على الأقل)' : 'New password (min 8 chars)'}
                      value={pwdInput}
                      onChange={(e) => setPwdInput(e.target.value)}
                      autoFocus
                    />
                    <button className="btn-primary text-xs px-3 py-1.5 shrink-0" disabled={pwdSaving || pwdInput.length < 8} onClick={() => setPassword(u.email)}>
                      {pwdSaving ? (isArabic ? 'جاري الحفظ…' : 'Saving…') : (isArabic ? 'حفظ' : 'Save')}
                    </button>
                    <button className="btn-secondary text-xs px-3 py-1.5 shrink-0" onClick={() => { setPwdTarget(null); setPwdInput(''); }}>
                      {isArabic ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                )}

                {editing ? (
                  <PermissionPicker value={currentPerms} onChange={(v) => setEditPerms((prev) => ({ ...prev, [u.email]: v }))} isArabic={isArabic} />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {u.permissions.length === 0
                      ? <span className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'لا توجد صلاحيات' : 'No permissions'}</span>
                      : u.permissions.map((p) => <PermissionBadge key={p} perm={p} />)}
                  </div>
                )}
              </div>
            );
          })}
          {users.length === 0 && !usersLoading && (
            <p className="py-8 text-center text-[color:var(--fg-2)]">{isArabic ? 'لا يوجد مستخدمون بعد.' : 'No users yet.'}</p>
          )}
        </div>
      </section>
    </div>
  );
}
