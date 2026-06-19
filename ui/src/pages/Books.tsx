import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ExternalLink, Search, ArrowUpDown, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useApi, apiRequest } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';
import { useToast } from '../hooks/useToast.tsx';
import type { BookListItem } from '@api';

const PROCESSING_LABEL: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Processing…',
  succeeded: 'Done',
  failed: 'Failed',
};
const DOSSIER_LABEL: Record<string, string> = {
  pending: 'Pending',
  generating: 'Building…',
  ready: 'Ready',
  failed: 'Failed',
};

const STATUS_COLORS: Record<string, string> = {
  succeeded: 'badge-green',
  ready: 'badge-green',
  synced: 'badge-green',
  completed: 'badge-green',
  running: 'badge-yellow',
  generating: 'badge-yellow',
  queued: 'badge-yellow',
  syncing: 'badge-yellow',
  failed: 'badge-red',
};

function badge(status: string, label?: string) {
  const cls = STATUS_COLORS[status] ?? 'badge-gray';
  return <span className={cls}>{label ?? status}</span>;
}

type SortKey = 'title' | 'publisherName' | 'processingStatus' | 'dossierStatus';

export default function Books() {
  const { data, loading, error, refetch } = useApi<{ audiobooks: BookListItem[] }>('/api/dashboard');
  const { data: meData } = useApi<{ user: { permissions: string[] } }>('/api/auth/me');
  const isAdmin = meData?.user.permissions.includes('users') ?? false;
  const { isArabic } = useLocale();
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [filterPublisher, setFilterPublisher] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ failed: true, sent: true, ready: true, progress: true });

  const books = useMemo(() => data?.audiobooks ?? [], [data]);
  const publisherOptions = useMemo(() => [...new Set(books.map((b) => b.publisherName))].sort(), [books]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books
      .filter((b) => {
        if (q && !b.title.toLowerCase().includes(q) && !b.publisherName.toLowerCase().includes(q) && !(b.isbn ?? '').toLowerCase().includes(q) && !(b.author ?? '').toLowerCase().includes(q)) return false;
        if (filterPublisher && b.publisherName !== filterPublisher) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }, [books, query, filterPublisher, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  function toggleGroup(key: string) { setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] })); }

  async function deleteOne(id: string) {
    setDeleting(true);
    try {
      await apiRequest(`/api/books/${id}`, { method: 'DELETE' });
      addToast(isArabic ? 'تم حذف الكتاب.' : 'Book deleted.', 'success');
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    } finally { setDeleting(false); setConfirmDelete(null); }
  }

  async function deleteBulk() {
    const ids = [...selected];
    setDeleting(true);
    try {
      await apiRequest('/api/books/bulk-delete', { method: 'POST', body: { ids } });
      addToast(isArabic ? `تم حذف ${ids.length} كتاب.` : `${ids.length} books deleted.`, 'success');
      setSelected(new Set());
      refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : (isArabic ? 'فشل الحذف' : 'Delete failed'), 'error');
    } finally { setDeleting(false); setConfirmDelete(null); }
  }

  function SortHeader({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <button type="button"
        className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wide whitespace-nowrap ${active ? 'text-sky-700' : 'text-[color:var(--fg-2)]'}`}
        onClick={() => toggleSort(col)}>
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    );
  }

  // Split into groups — failed books always first
  const failedBooks  = filtered.filter((b) => b.processingStatus === 'failed' || b.dossierStatus === 'failed');
  const sentToClickUp = filtered.filter((b) => b.dossierStatus === 'ready' && b.clickupSyncStatus === 'synced' && b.processingStatus !== 'failed');
  const readyNotSent  = filtered.filter((b) => b.dossierStatus === 'ready' && b.clickupSyncStatus !== 'synced' && b.processingStatus !== 'failed');
  const inProgress    = filtered.filter((b) => b.dossierStatus !== 'ready' && b.processingStatus !== 'failed' && b.dossierStatus !== 'failed');

  const hasFilters = query || filterPublisher;

  if (loading) return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  if (error) return (
    <div className="card border-red-200 bg-red-50 text-red-700 flex items-center gap-2">
      <AlertCircle className="h-5 w-5 shrink-0" />
      {isArabic ? 'فشل تحميل الكتب' : 'Failed to load books'}: {error}
    </div>
  );

  function BookTable({ groupBooks, redRows = false }: { groupBooks: BookListItem[]; redRows?: boolean }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-[rgba(11,128,255,0.03)] border-b border-slate-100">
            <tr>
              {isAdmin && <th className="px-4 py-2.5 w-8"><input type="checkbox" className="h-4 w-4 rounded border-gray-300"
                checked={groupBooks.length > 0 && groupBooks.every((b) => selected.has(b.id))}
                onChange={(e) => setSelected((prev) => { const n = new Set(prev); groupBooks.forEach((b) => e.target.checked ? n.add(b.id) : n.delete(b.id)); return n; })} /></th>}
              <th className="px-4 py-2.5 text-start"><SortHeader col="title" label={isArabic ? 'العنوان' : 'Title'} /></th>
              <th className="px-4 py-2.5 text-start"><SortHeader col="publisherName" label={isArabic ? 'الناشر' : 'Publisher'} /></th>
              <th className="px-4 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-[color:var(--fg-2)] whitespace-nowrap">{isArabic ? 'المؤلف' : 'Author'}</th>
              <th className="px-4 py-2.5 text-start"><SortHeader col="processingStatus" label={isArabic ? 'المعالجة' : 'Processing'} /></th>
              <th className="px-4 py-2.5 text-start"><SortHeader col="dossierStatus" label={isArabic ? 'الدوسيه' : 'Dossier'} /></th>
              <th className="px-4 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-[color:var(--fg-2)]">ClickUp</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {groupBooks.map((book) => {
              const processingFailed = book.processingStatus === 'failed';
              const dossierFailed = book.dossierStatus === 'failed';
              const rowClass = selected.has(book.id) ? 'bg-sky-50/40' : redRows && (processingFailed || dossierFailed) ? 'bg-red-50/30' : '';
              return (
                <tr key={book.id} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors ${rowClass}`}>
                  {isAdmin && (
                    <td className="px-4 py-3 w-8">
                      <input type="checkbox" className="h-4 w-4 rounded border-gray-300"
                        checked={selected.has(book.id)}
                        onChange={(e) => setSelected((prev) => { const n = new Set(prev); e.target.checked ? n.add(book.id) : n.delete(book.id); return n; })} />
                    </td>
                  )}
                  <td className="px-4 py-3 max-w-[240px]">
                    <span className="font-semibold text-[color:var(--samawy-ink)] line-clamp-2 leading-snug">{book.title}</span>
                    {book.isbn && <div className="text-[10px] font-mono text-[color:var(--fg-2)] opacity-60 mt-0.5">{book.isbn}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-[color:var(--fg-2)]">{book.publisherName}</td>
                  <td className="px-4 py-3 max-w-[140px] text-xs text-[color:var(--fg-2)]">
                    <div className="truncate">{book.author ?? <span className="opacity-40">—</span>}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {badge(book.processingStatus, PROCESSING_LABEL[book.processingStatus] ?? book.processingStatus)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {badge(book.dossierStatus, DOSSIER_LABEL[book.dossierStatus] ?? book.dossierStatus)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {book.clickupSyncStatus === 'never_synced' || book.clickupSyncStatus === 'syncing' ? (
                      <span className="text-xs text-[color:var(--fg-2)] opacity-40">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {badge(book.clickupSyncStatus)}
                        {book.clickupTaskUrl && (
                          <a href={book.clickupTaskUrl} target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-800" title="Open ClickUp task">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Link to={`/books/${book.id}`} className="btn-secondary text-xs py-1 px-3">{isArabic ? 'إدارة' : 'Manage'}</Link>
                      {isAdmin && (
                        confirmDelete === book.id ? (
                          <div className="flex items-center gap-1">
                            <button type="button" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={deleting} onClick={() => deleteOne(book.id)}>{isArabic ? 'تأكيد' : 'Confirm'}</button>
                            <button type="button" className="text-[10px] text-gray-500 hover:text-gray-700" onClick={() => setConfirmDelete(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
                          </div>
                        ) : (
                          <button type="button" className="text-red-400 hover:text-red-600 p-1 rounded" title={isArabic ? 'حذف' : 'Delete'} onClick={() => setConfirmDelete(book.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk delete confirm */}
      {confirmDelete === 'bulk' && (
        <div className="card border-red-200 bg-red-50 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-red-800 font-medium flex-1">{isArabic ? `حذف ${selected.size} كتاب نهائياً؟` : `Permanently delete ${selected.size} book(s)?`}</span>
          <button type="button" className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={deleting} onClick={deleteBulk}>{isArabic ? 'نعم، احذف' : 'Yes, delete'}</button>
          <button type="button" className="text-xs text-red-700 hover:text-red-900" onClick={() => setConfirmDelete(null)}>{isArabic ? 'إلغاء' : 'Cancel'}</button>
        </div>
      )}

      {/* Header + search */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="section-title">{isArabic ? 'كتالوج الكتب الصوتية' : 'Audiobook catalog'}</h2>
            <p className="section-subtitle">{filtered.length}{books.length !== filtered.length ? `/${books.length}` : ''} {isArabic ? 'عنوان' : 'titles'}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && selected.size > 0 && (
              <button type="button" className="btn-danger text-xs py-1.5 px-3" onClick={() => setConfirmDelete('bulk')}>
                <Trash2 className="h-3.5 w-3.5" />
                {isArabic ? `حذف ${selected.size} محدد` : `Delete ${selected.size} selected`}
              </button>
            )}
            {hasFilters && (
              <button type="button" className="text-xs text-sky-600 hover:text-sky-800 underline"
                onClick={() => { setQuery(''); setFilterPublisher(''); }}>
                {isArabic ? 'مسح الفلاتر' : 'Clear filters'}
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--fg-2)] pointer-events-none ltr:left-3 rtl:right-3" />
            <input type="search" className="input ltr:pl-9 rtl:pr-9 text-sm w-full"
              placeholder={isArabic ? 'بحث في العناوين، الناشرين، ISBN…' : 'Search titles, publishers, ISBN…'}
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="input text-sm w-auto" value={filterPublisher} onChange={(e) => setFilterPublisher(e.target.value)}>
            <option value="">{isArabic ? 'كل الناشرين' : 'All publishers'}</option>
            {publisherOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </section>

      {filtered.length === 0 && (
        <div className="card p-10 text-center text-sm text-[color:var(--fg-2)]">
          {hasFilters ? (isArabic ? 'لا توجد نتائج.' : 'No results.') : (isArabic ? 'لا توجد عناوين بعد.' : 'No books yet.')}
        </div>
      )}

      {/* ── Needs attention (always expanded, red border) ── */}
      {failedBooks.length > 0 && (
        <section className="card p-0 overflow-hidden border-red-200">
          <button type="button"
            className="w-full flex items-center gap-3 px-4 py-3 bg-red-50 hover:bg-red-100/60 transition-colors text-left border-b border-red-100"
            onClick={() => toggleGroup('failed')}>
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-sm font-semibold text-red-800 flex-1">{isArabic ? 'تحتاج إلى تدخل' : 'Needs attention'}</span>
            <span className="text-xs font-medium text-red-700 bg-red-100 rounded-full px-2 py-0.5">{failedBooks.length}</span>
            {openGroups.failed ? <ChevronDown className="h-4 w-4 text-red-400" /> : <ChevronRight className="h-4 w-4 text-red-400" />}
          </button>
          {openGroups.failed && <BookTable groupBooks={failedBooks} redRows />}
        </section>
      )}

      {/* ── Other groups ── */}
      {(
        [
          { key: 'sent',     groupBooks: sentToClickUp, label: isArabic ? 'مكتمل ومُرسل إلى ClickUp' : 'Done — synced to ClickUp', dot: 'bg-emerald-500' },
          { key: 'ready',    groupBooks: readyNotSent,  label: isArabic ? 'جاهز — لم يُرسل بعد'      : 'Ready — not sent yet',      dot: 'bg-amber-400'  },
          { key: 'progress', groupBooks: inProgress,    label: isArabic ? 'قيد التنفيذ'              : 'In progress',               dot: 'bg-slate-300'  },
        ] as const
      ).map(({ key, groupBooks, label, dot }) => groupBooks.length === 0 ? null : (
        <section key={key} className="card p-0 overflow-hidden">
          <button type="button"
            className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50/60 hover:bg-slate-100/60 transition-colors text-left border-b border-slate-100"
            onClick={() => toggleGroup(key)}>
            <span className={`h-2.5 w-2.5 rounded-full ${dot} shrink-0`} />
            <span className="text-sm font-semibold text-[color:var(--samawy-ink)] flex-1">{label}</span>
            <span className="text-xs font-medium text-[color:var(--fg-2)] bg-slate-200/60 rounded-full px-2 py-0.5">{groupBooks.length}</span>
            {openGroups[key] ? <ChevronDown className="h-4 w-4 text-[color:var(--fg-2)]" /> : <ChevronRight className="h-4 w-4 text-[color:var(--fg-2)]" />}
          </button>
          {openGroups[key] && <BookTable groupBooks={groupBooks} />}
        </section>
      ))}
    </div>
  );
}
