import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AudioLines, BookOpen, CheckCircle2, Cloud, FolderKanban,
  AlertCircle, ExternalLink, TrendingUp, Clock, HardDrive,
  Layers, BarChart3, Zap, RefreshCw,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';
import { InlineError } from '../components/InlineError';
import { ProductionStageBadge } from '../components/ProductionStageBadge';
import { PRODUCTION_STAGE_ORDER, type ProductionStage } from '@api';

interface DashboardData {
  batches: Array<{ id: string; status: string; sellerName: string | null; sourceType: string; createdAt: string }>;
  audiobooks: Array<{
    id: string; title: string; publisherName: string;
    processingStatus: string; dossierStatus: string; clickupSyncStatus: string;
    totalLengthSeconds: number; totalOriginalSizeBytes: number; totalFinalSizeBytes: number;
    trackCount: number; sellingType: string | null; createdAt: string;
    productionStage?: ProductionStage;
  }>;
  summaries: {
    totalBatches: number; totalBooks: number;
    batchStatusCounts: Record<string, number>;
    processingStatusCounts: Record<string, number>;
    dossierStatusCounts: Record<string, number>;
    clickupSyncCounts: Record<string, number>;
    retainedStorage: { retainedBytes: number; retainedObjects: number };
  };
}

function fmt(bytes: number) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${Math.max(mb, 0.01).toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function fmtHours(seconds: number) {
  const h = seconds / 3600;
  return h >= 100 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}

// ── Mini bar: shows value/total as a filled strip ─────────────────────────────
function MiniBar({ value, total, color = 'bg-sky-500' }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-[color:var(--fg-2)] w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, icon: Icon, color, to }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; to?: string;
}) {
  const inner = (
    <div className={`card flex items-start gap-4 hover:shadow-md transition-shadow`}>
      <div className={`rounded-xl p-2.5 shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[color:var(--fg-2)] leading-none mb-1.5">{label}</p>
        <p className="text-2xl font-black text-[color:var(--samawy-ink)] leading-none">{value}</p>
        {sub && <p className="mt-1.5 text-[11px] text-[color:var(--fg-2)]">{sub}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

// ── Horizontal stacked progress ───────────────────────────────────────────────
function StackedBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <div className="h-3 rounded-full bg-slate-100" />;
  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-px">
      {segments.filter(s => s.value > 0).map(s => (
        <div
          key={s.label}
          className={`${s.color} h-full transition-all`}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={`${s.label}: ${s.value}`}
        />
      ))}
    </div>
  );
}

// ── Funnel step ───────────────────────────────────────────────────────────────
function FunnelStep({ n, label, value, total, color }: {
  n: number; label: string; value: number; total: number; color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${color}`}>{n}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-[color:var(--samawy-ink)] truncate">{label}</span>
          <span className="text-xs font-bold text-[color:var(--samawy-ink)] tabular-nums ml-2">{value}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="text-[11px] text-[color:var(--fg-2)] w-8 text-right tabular-nums">{pct}%</span>
    </div>
  );
}

const PROCESSING_COLOR: Record<string, string> = {
  succeeded: 'bg-emerald-500',
  running:   'bg-sky-500',
  queued:    'bg-violet-400',
  failed:    'bg-red-500',
  pending:   'bg-slate-300',
};

const DOSSIER_COLOR: Record<string, string> = {
  ready:          'bg-emerald-500',
  generating:     'bg-sky-500',
  sample_pending: 'bg-violet-400',
  failed:         'bg-red-500',
  pending:        'bg-slate-300',
};

const SYNC_COLOR: Record<string, string> = {
  synced:       'bg-emerald-500',
  syncing:      'bg-sky-400',
  failed:       'bg-red-500',
  never_synced: 'bg-slate-200',
};


export default function Dashboard() {
  const { data, loading, error, errorDetail } = useApi<DashboardData>('/api/dashboard');
  const { isArabic } = useLocale();

  const computed = useMemo(() => {
    if (!data) return null;
    const books = data.audiobooks;
    const batches = data.batches;
    const s = data.summaries;

    // Unified production stage distribution (studio → pipeline chain)
    const stageCounts: Record<string, number> = {};
    for (const b of books) {
      if (!b.productionStage) continue;
      stageCounts[b.productionStage] = (stageCounts[b.productionStage] ?? 0) + 1;
    }

    // Content totals
    const totalSeconds = books.reduce((a, b) => a + (b.totalLengthSeconds ?? 0), 0);
    const totalOrigBytes = books.reduce((a, b) => a + (b.totalOriginalSizeBytes ?? 0), 0);
    const totalFinalBytes = books.reduce((a, b) => a + (b.totalFinalSizeBytes ?? 0), 0);
    const avgTracks = books.length > 0 ? books.reduce((a, b) => a + (b.trackCount ?? 0), 0) / books.length : 0;
    const compressionRatio = totalOrigBytes > 0 ? totalFinalBytes / totalOrigBytes : 0;

    // Publisher distribution (top 8)
    const pubCounts: Record<string, number> = {};
    for (const b of books) pubCounts[b.publisherName] = (pubCounts[b.publisherName] ?? 0) + 1;
    const topPublishers = Object.entries(pubCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Selling type
    const subCount = books.filter(b => b.sellingType === 'subscription').length;
    const alaCount = books.filter(b => b.sellingType === 'a_la_carte').length;
    const unknownSelling = books.length - subCount - alaCount;

    // Failed books (need attention)
    const failedBooks = books.filter(b => b.processingStatus === 'failed' || b.dossierStatus === 'failed').slice(0, 6);

    // Recent batches
    const recentBatches = [...batches].slice(0, 6);

    // Source type split
    const driveCount = batches.filter(b => b.sourceType === 'drive').length;
    const uploadCount = batches.length - driveCount;

    // Pipeline funnel
    const total = books.length;
    const processingDone = s.processingStatusCounts.succeeded ?? 0;
    const dossierReady = s.dossierStatusCounts.ready ?? 0;
    const clickupSynced = s.clickupSyncCounts.synced ?? 0;

    // Active right now
    const activeProcessing = (s.processingStatusCounts.running ?? 0) + (s.processingStatusCounts.queued ?? 0);
    const activeDossier = (s.dossierStatusCounts.generating ?? 0) + (s.dossierStatusCounts.sample_pending ?? 0);

    return {
      totalSeconds, totalOrigBytes, totalFinalBytes, avgTracks, compressionRatio,
      topPublishers, subCount, alaCount, unknownSelling,
      failedBooks, recentBatches, driveCount, uploadCount,
      total, processingDone, dossierReady, clickupSynced,
      activeProcessing, activeDossier, stageCounts,
    };
  }, [data]);

  if (loading) return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</div>;
  if (error) return <InlineError message={error} detail={errorDetail ?? undefined} />;
  if (!data || !computed) return null;

  const s = data.summaries;
  const c = computed;

  const processingSegments = Object.entries(s.processingStatusCounts).map(([label, value]) => ({
    label, value, color: PROCESSING_COLOR[label] ?? 'bg-slate-300',
  }));
  const dossierSegments = Object.entries(s.dossierStatusCounts).map(([label, value]) => ({
    label, value, color: DOSSIER_COLOR[label] ?? 'bg-slate-300',
  }));
  const syncSegments = Object.entries(s.clickupSyncCounts).map(([label, value]) => ({
    label, value, color: SYNC_COLOR[label] ?? 'bg-slate-300',
  }));

  const totalFailed = (s.processingStatusCounts.failed ?? 0) + (s.dossierStatusCounts.failed ?? 0);

  return (
    <div className="space-y-5">

      {/* ── KPI Row ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KPI
          label={isArabic ? 'إجمالي الكتب' : 'Total books'}
          value={s.totalBooks}
          sub={isArabic ? `من ${s.totalBatches} دفعة` : `across ${s.totalBatches} batches`}
          icon={BookOpen} color="bg-sky-100 text-sky-600" to="/books"
        />
        <KPI
          label={isArabic ? 'الدوسيهات الجاهزة' : 'Dossiers ready'}
          value={c.dossierReady}
          sub={isArabic ? `${c.clickupSynced} مُرسل إلى ClickUp` : `${c.clickupSynced} synced to ClickUp`}
          icon={CheckCircle2} color="bg-emerald-100 text-emerald-600" to="/books"
        />
        <KPI
          label={isArabic ? 'ساعات الصوت الكاملة' : 'Total audio'}
          value={fmtHours(c.totalSeconds)}
          sub={isArabic ? `متوسط ${c.avgTracks.toFixed(1)} مسار/كتاب` : `avg ${c.avgTracks.toFixed(1)} tracks/book`}
          icon={AudioLines} color="bg-violet-100 text-violet-600"
        />
        <KPI
          label={isArabic ? 'يحتاج انتباهاً' : 'Needs attention'}
          value={totalFailed}
          sub={isArabic ? 'فشل المعالجة أو الدوسيه' : 'processing or dossier failed'}
          icon={totalFailed > 0 ? AlertCircle : CheckCircle2}
          color={totalFailed > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}
          to="/books"
        />
      </div>

      {/* ── Unified production stages (studio → pipeline) ── */}
      <section className="card space-y-4">
        <div>
          <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-500" />
            {isArabic ? 'مراحل الإنتاج الموحّدة' : 'Unified production stages'}
          </h3>
          <p className="text-xs text-[color:var(--fg-2)] mt-0.5">
            {isArabic ? 'موضع كل عنوان عبر سلسلة الاستوديو ← المعالجة ← المزامنة' : 'Where every title sits across the studio → processing → sync chain'}
          </p>
        </div>
        {(() => {
          const order = [...PRODUCTION_STAGE_ORDER, 'failed' as ProductionStage];
          const maxCount = Math.max(1, ...order.map((st) => c.stageCounts[st] ?? 0));
          const present = order.filter((st) => (c.stageCounts[st] ?? 0) > 0);
          if (present.length === 0) return <p className="text-sm text-[color:var(--fg-2)]">{isArabic ? 'لا توجد بيانات بعد.' : 'No data yet.'}</p>;
          return (
            <div className="space-y-2">
              {present.map((st) => {
                const v = c.stageCounts[st] ?? 0;
                return (
                  <div key={st} className="flex items-center gap-3">
                    <div className="w-28 shrink-0"><ProductionStageBadge stage={st} isArabic={isArabic} /></div>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-violet-400 transition-transform origin-left" style={{ transform: `scaleX(${v / maxCount})` }} />
                    </div>
                    <span className="w-10 text-right text-sm font-semibold text-[color:var(--samawy-ink)]">{v}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      <div className="grid gap-5 xl:grid-cols-3">

        {/* ── Pipeline funnel ── */}
        <div className="card space-y-5 xl:col-span-1">
          <div>
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-sky-500" />
              {isArabic ? 'مسار الإنتاج' : 'Production funnel'}
            </h3>
            <p className="text-xs text-[color:var(--fg-2)] mt-0.5">{isArabic ? 'عدد الكتب في كل مرحلة' : 'Books at each pipeline stage'}</p>
          </div>
          <div className="space-y-4">
            <FunnelStep n={1} label={isArabic ? 'كتب في الكتالوج' : 'In catalog'} value={c.total} total={c.total} color="bg-slate-400" />
            <FunnelStep n={2} label={isArabic ? 'اكتملت المعالجة' : 'Processing done'} value={c.processingDone} total={c.total} color="bg-sky-500" />
            <FunnelStep n={3} label={isArabic ? 'الدوسيه جاهز' : 'Dossier ready'} value={c.dossierReady} total={c.total} color="bg-violet-500" />
            <FunnelStep n={4} label={isArabic ? 'مُرسل إلى ClickUp' : 'Synced to ClickUp'} value={c.clickupSynced} total={c.total} color="bg-emerald-500" />
          </div>
          {(c.activeProcessing > 0 || c.activeDossier > 0) && (
            <div className="border-t border-slate-100 pt-4 space-y-2">
              <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide">{isArabic ? 'نشط الآن' : 'Active now'}</p>
              {c.activeProcessing > 0 && (
                <div className="flex items-center gap-2 text-xs text-sky-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                  {c.activeProcessing} {isArabic ? 'كتاب قيد المعالجة' : 'books processing'}
                </div>
              )}
              {c.activeDossier > 0 && (
                <div className="flex items-center gap-2 text-xs text-violet-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
                  {c.activeDossier} {isArabic ? 'دوسيه يُنشأ' : 'dossiers generating'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Status breakdowns ── */}
        <div className="card space-y-5 xl:col-span-2">
          <div>
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-500" />
              {isArabic ? 'توزيع الحالات' : 'Status breakdown'}
            </h3>
            <p className="text-xs text-[color:var(--fg-2)] mt-0.5">{isArabic ? 'المعالجة والدوسيه والمزامنة' : 'Processing, dossier, and sync'}</p>
          </div>

          {/* Processing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide">{isArabic ? 'المعالجة' : 'Processing'}</p>
            </div>
            <StackedBar segments={processingSegments} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {processingSegments.map(seg => (
                <div key={seg.label} className="flex items-center gap-1.5 text-[11px] text-[color:var(--fg-2)]">
                  <span className={`h-2 w-2 rounded-full ${seg.color}`} />
                  {seg.label} <span className="font-semibold text-[color:var(--samawy-ink)]">{seg.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dossier */}
          <div>
            <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide mb-2">{isArabic ? 'الدوسيه' : 'Dossier'}</p>
            <StackedBar segments={dossierSegments} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {dossierSegments.map(seg => (
                <div key={seg.label} className="flex items-center gap-1.5 text-[11px] text-[color:var(--fg-2)]">
                  <span className={`h-2 w-2 rounded-full ${seg.color}`} />
                  {seg.label} <span className="font-semibold text-[color:var(--samawy-ink)]">{seg.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ClickUp sync */}
          <div>
            <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide mb-2">ClickUp {isArabic ? 'المزامنة' : 'sync'}</p>
            <StackedBar segments={syncSegments} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {syncSegments.map(seg => (
                <div key={seg.label} className="flex items-center gap-1.5 text-[11px] text-[color:var(--fg-2)]">
                  <span className={`h-2 w-2 rounded-full ${seg.color}`} />
                  {seg.label} <span className="font-semibold text-[color:var(--samawy-ink)]">{seg.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Batch statuses */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide mb-3">{isArabic ? 'الدُفعات' : 'Batches'} <span className="font-normal normal-case">({s.totalBatches})</span></p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              {Object.entries(s.batchStatusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-xs">
                  <span className="text-[color:var(--fg-2)] truncate">{status.replace(/_/g, ' ')}</span>
                  <span className="font-bold text-[color:var(--samawy-ink)] ml-2 tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">

        {/* ── Publisher distribution ── */}
        <div className="card space-y-4 xl:col-span-1">
          <div>
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-500" />
              {isArabic ? 'الناشرون' : 'Publishers'}
            </h3>
            <p className="text-xs text-[color:var(--fg-2)] mt-0.5">{isArabic ? 'كتب لكل ناشر' : 'Books per publisher'}</p>
          </div>
          <div className="space-y-3">
            {c.topPublishers.map(([name, count]) => (
              <div key={name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[color:var(--samawy-ink)] font-medium truncate max-w-[75%]">{name}</span>
                  <span className="text-xs font-bold tabular-nums text-[color:var(--samawy-ink)]">{count}</span>
                </div>
                <MiniBar value={count} total={c.topPublishers[0]?.[1] ?? 1} color="bg-sky-400" />
              </div>
            ))}
            {c.topPublishers.length === 0 && <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'لا توجد بيانات بعد' : 'No data yet'}</p>}
          </div>
        </div>

        {/* ── Content & storage stats ── */}
        <div className="card space-y-5 xl:col-span-2">
          <div>
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-sky-500" />
              {isArabic ? 'إحصاءات المحتوى والتخزين' : 'Content & storage stats'}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: isArabic ? 'إجمالي الصوت' : 'Total audio',
                value: fmtHours(c.totalSeconds),
                sub: isArabic ? 'ساعات إنتاج' : 'production hours',
                icon: Clock,
                color: 'text-violet-600 bg-violet-50',
              },
              {
                label: isArabic ? 'متوسط المسارات' : 'Avg tracks',
                value: c.avgTracks.toFixed(1),
                sub: isArabic ? 'مسار لكل كتاب' : 'per book',
                icon: AudioLines,
                color: 'text-sky-600 bg-sky-50',
              },
              {
                label: isArabic ? 'التخزين الأصلي' : 'Original storage',
                value: fmt(c.totalOrigBytes),
                sub: isArabic ? 'ملفات المصدر' : 'source files',
                icon: HardDrive,
                color: 'text-amber-600 bg-amber-50',
              },
              {
                label: isArabic ? 'التخزين النهائي' : 'Final storage',
                value: fmt(c.totalFinalBytes),
                sub: c.compressionRatio > 0 ? `${Math.round(c.compressionRatio * 100)}% ${isArabic ? 'من الأصلي' : 'of original'}` : '—',
                icon: Zap,
                color: 'text-emerald-600 bg-emerald-50',
              },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl border border-slate-100 p-3 space-y-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.color}`}>
                  <stat.icon className="h-4 w-4" />
                </div>
                <p className="text-xl font-black text-[color:var(--samawy-ink)] leading-none">{stat.value}</p>
                <div>
                  <p className="text-[11px] font-medium text-[color:var(--samawy-ink)]">{stat.label}</p>
                  <p className="text-[11px] text-[color:var(--fg-2)]">{stat.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Retained dossier storage */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide mb-1">{isArabic ? 'تخزين الدوسيهات المحتفظ بها' : 'Retained dossier storage'}</p>
              <p className="text-2xl font-black text-[color:var(--samawy-ink)]">{fmt(s.retainedStorage.retainedBytes)}</p>
              <p className="text-xs text-[color:var(--fg-2)] mt-0.5">{s.retainedStorage.retainedObjects} {isArabic ? 'ملف' : 'objects'}</p>
            </div>
            <Link to="/artifacts" className="btn-secondary text-xs shrink-0">{isArabic ? 'استعراض الملفات' : 'Browse artifacts'}</Link>
          </div>

          {/* Selling type breakdown */}
          <div>
            <p className="text-xs font-semibold text-[color:var(--fg-2)] uppercase tracking-wide mb-3">{isArabic ? 'نوع البيع' : 'Selling type'}</p>
            <div className="flex gap-2">
              {[
                { label: isArabic ? 'اشتراك' : 'Subscription', value: c.subCount, color: 'bg-sky-500' },
                { label: isArabic ? 'أفرادي' : 'À la carte', value: c.alaCount, color: 'bg-violet-500' },
                { label: isArabic ? 'غير محدد' : 'Unset', value: c.unknownSelling, color: 'bg-slate-300' },
              ].filter(x => x.value > 0).map(x => (
                <div key={x.label} className="flex-1 rounded-xl border border-slate-100 p-3 text-center">
                  <div className={`h-1.5 w-8 rounded-full mx-auto mb-2 ${x.color}`} />
                  <p className="text-lg font-black text-[color:var(--samawy-ink)]">{x.value}</p>
                  <p className="text-[11px] text-[color:var(--fg-2)]">{x.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Batch source types */}
          <div className="flex items-center gap-4 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-[color:var(--fg-2)]">
              <FolderKanban className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-semibold text-[color:var(--samawy-ink)]">{c.driveCount}</span> {isArabic ? 'دفعة Drive' : 'Drive batches'}
            </div>
            <div className="flex items-center gap-2 text-xs text-[color:var(--fg-2)]">
              <Cloud className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-semibold text-[color:var(--samawy-ink)]">{c.uploadCount}</span> {isArabic ? 'دفعة رفع' : 'Upload batches'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom row: failed books + recent batches ── */}
      <div className="grid gap-5 xl:grid-cols-2">

        {/* Failed books */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              {isArabic ? 'يحتاج انتباهاً' : 'Needs attention'}
            </h3>
            <Link to="/books" className="text-xs text-sky-600 hover:underline">{isArabic ? 'عرض الكل' : 'View all'}</Link>
          </div>
          {c.failedBooks.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 py-2">
              <CheckCircle2 className="h-4 w-4" />
              {isArabic ? 'لا توجد كتب بحاجة إلى انتباه.' : 'No books need attention.'}
            </div>
          ) : (
            <div className="space-y-2">
              {c.failedBooks.map(book => (
                <Link key={book.id} to={`/books/${book.id}`}
                  className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50/40 px-3 py-2.5 hover:bg-red-50 transition-colors gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[color:var(--samawy-ink)] truncate">{book.title}</p>
                    <p className="text-[11px] text-[color:var(--fg-2)] mt-0.5">{book.publisherName}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {book.processingStatus === 'failed' && <span className="badge-red text-[10px]">{isArabic ? 'معالجة' : 'processing'}</span>}
                    {book.dossierStatus === 'failed' && <span className="badge-red text-[10px]">{isArabic ? 'دوسيه' : 'dossier'}</span>}
                    <ExternalLink className="h-3 w-3 text-red-400" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent batches */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[color:var(--samawy-ink)] flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-sky-500" />
              {isArabic ? 'آخر الدُفعات' : 'Recent batches'}
            </h3>
            <Link to="/intake" className="text-xs text-sky-600 hover:underline">{isArabic ? 'عرض الكل' : 'View all'}</Link>
          </div>
          {c.recentBatches.length === 0 ? (
            <p className="text-sm text-[color:var(--fg-2)] py-2">{isArabic ? 'لا توجد دفعات بعد.' : 'No batches yet.'}</p>
          ) : (
            <div className="space-y-2">
              {c.recentBatches.map(batch => {
                const dotColor = batch.status === 'records_created' ? 'bg-emerald-500'
                  : batch.status.includes('failed') ? 'bg-red-500'
                  : batch.status === 'normalized' || batch.status === 'metadata_parsed' ? 'bg-sky-400'
                  : 'bg-slate-300';
                return (
                  <Link key={batch.id} to={`/intake/${batch.id}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 hover:border-sky-200 hover:bg-slate-50 transition-colors">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[color:var(--samawy-ink)] truncate">
                        {batch.sellerName ?? (isArabic ? 'بائع غير معروف' : 'Unknown seller')}
                      </p>
                      <p className="text-[11px] text-[color:var(--fg-2)] mt-0.5">{batch.status.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-[color:var(--fg-2)]">
                        {new Date(batch.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </p>
                      <span className="text-[10px] text-slate-400">{batch.sourceType}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
