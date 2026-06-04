import { AlertCircle, BarChart3, Database, HardDrive, Link2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';

function formatStorageSize(bytes: number) {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.max(mb, 0.01).toFixed(mb >= 10 ? 1 : 2)} MB`;
}

interface DashboardData {
  summaries: {
    batchStatusCounts: Record<string, number>;
    processingStatusCounts: Record<string, number>;
    dossierStatusCounts: Record<string, number>;
    clickupSyncCounts: Record<string, number>;
  };
}

interface StorageData {
  retainedBytes: number;
  retainedObjects: number;
  tempBytes: number;
  tempObjects: number;
  retainedByPublisher: Record<string, { bytes: number; objects: number }>;
  retainedByType: Record<string, { bytes: number; objects: number }>;
}

function MetricList({ title, icon: Icon, items }: {
  title: string;
  icon: React.ElementType;
  items: Record<string, number | { bytes: number; objects: number }>;
}) {
  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-3">
        <Icon className="h-5 w-5 text-[color:var(--samawy-blue)]" />
        <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{title}</h3>
      </div>
      <div className="space-y-3">
        {Object.entries(items).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between rounded-[20px] bg-[rgba(11,128,255,0.04)] px-4 py-3">
            <span className="text-sm text-[color:var(--fg-2)]">{key}</span>
            <span className="font-semibold text-[color:var(--samawy-ink)]">
              {typeof value === 'number' ? value : `${formatStorageSize(value.bytes)} · ${value.objects} ملف`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Analytics() {
  const dashboard = useApi<DashboardData>('/api/dashboard');
  const storage = useApi<StorageData>('/api/artifacts/analytics');
  const { isArabic } = useLocale();

  if (dashboard.loading || storage.loading) {
    return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري تحميل التحليلات…' : 'Loading analytics…'}</div>;
  }

  if (dashboard.error || storage.error) {
    return (
      <div className="card border-red-200 bg-red-50 text-red-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {dashboard.error || storage.error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="section-title">{isArabic ? 'التحليلات التشغيلية' : 'Operational analytics'}</h2>
        <p className="section-subtitle">{isArabic ? 'عرض لحالة الدُفعات، المعالجة، المزامنة، والتخزين النهائي مقابل المؤقت.' : 'A view across batch state, processing, sync, and final-versus-temporary storage.'}</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <MetricList title={isArabic ? 'حالات الدُفعات' : 'Batch states'} icon={Database} items={dashboard.data?.summaries.batchStatusCounts ?? {}} />
        <MetricList title={isArabic ? 'حالات المعالجة' : 'Processing states'} icon={BarChart3} items={dashboard.data?.summaries.processingStatusCounts ?? {}} />
        <MetricList title={isArabic ? 'حالات الدوسيه' : 'Dossier states'} icon={HardDrive} items={dashboard.data?.summaries.dossierStatusCounts ?? {}} />
        <MetricList title={isArabic ? 'حالات ClickUp' : 'ClickUp states'} icon={Link2} items={dashboard.data?.summaries.clickupSyncCounts ?? {}} />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="card">
          <h3 className="mb-4 text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'ملخص التخزين' : 'Storage summary'}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[22px] bg-[rgba(11,128,255,0.04)] p-4">
              <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'الملفات النهائية' : 'Final assets'}</p>
              <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">{formatStorageSize(storage.data?.retainedBytes ?? 0)}</p>
              <p className="mt-2 text-xs text-[color:var(--fg-2)]">{storage.data?.retainedObjects ?? 0} {isArabic ? 'ملف' : 'objects'}</p>
            </div>
            <div className="rounded-[22px] bg-[rgba(1,11,38,0.04)] p-4">
              <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'المؤقتات والمخلفات' : 'Temp and residuals'}</p>
              <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">{formatStorageSize(storage.data?.tempBytes ?? 0)}</p>
              <p className="mt-2 text-xs text-[color:var(--fg-2)]">{storage.data?.tempObjects ?? 0} {isArabic ? 'ملف' : 'objects'}</p>
            </div>
          </div>
        </div>

        <MetricList title={isArabic ? 'الاحتفاظ حسب الناشر' : 'Retention by publisher'} icon={HardDrive} items={storage.data?.retainedByPublisher ?? {}} />
      </section>
    </div>
  );
}
