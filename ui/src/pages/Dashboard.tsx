import { AlertCircle, ArrowLeft, AudioLines, CheckCircle2, Cloud, Database, FolderKanban, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useLocale } from '../hooks/useLocale';

interface DashboardData {
  batches: Array<{
    id: string;
    status: string;
    sellerName: string | null;
    createdAt: string;
  }>;
  audiobooks: Array<{
    id: string;
    title: string;
    publisherName: string;
    processingStatus: string;
    dossierStatus: string;
    clickupSyncStatus: string;
  }>;
  summaries: {
    totalBatches: number;
    totalBooks: number;
    batchStatusCounts: Record<string, number>;
    processingStatusCounts: Record<string, number>;
    dossierStatusCounts: Record<string, number>;
    clickupSyncCounts: Record<string, number>;
    retainedStorage: {
      retainedBytes: number;
      retainedObjects: number;
    };
  };
}

function formatStorageSize(bytes: number) {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.max(mb, 0.01).toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function Metric({ title, value, note, icon: Icon, link }: {
  title: string;
  value: string | number;
  note: string;
  icon: React.ElementType;
  link: string;
}) {
  return (
    <Link to={link} className="metric-card block">
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm text-[color:var(--fg-2)]">{title}</p>
          <p className="mt-3 text-3xl font-black text-[color:var(--samawy-ink)]">{value}</p>
          <p className="mt-2 text-sm text-[color:var(--fg-2)]">{note}</p>
        </div>
        <div className="rounded-2xl bg-[rgba(11,128,255,0.1)] p-3 text-[color:var(--samawy-blue)]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { data, loading, error } = useApi<DashboardData>('/api/dashboard');
  const { isArabic } = useLocale();
  const flowSteps = isArabic
    ? [
        { title: 'بدء الدفعة', body: 'إما رابط Google Drive مع ملف Excel، أو ملف ZIP منفرد مع نموذج بيانات يدوي.' },
        { title: 'الاستقبال والتطبيع', body: 'يتم نسخ المصدر إلى R2، فحص بنيته، واستخراج المجموعات والملفات القابلة للعمل.' },
        { title: 'تطبيع البيانات', body: 'يتم تحويل ملف Excel غير المنظم إلى صفوف مهيكلة مع تقرير تطبيع يوضح الثغرات والالتباسات.' },
        { title: 'قفل البائع والمطابقة', body: 'بعد اختيار البائع من قاعدة سماوي المرجعية، تبدأ المطابقة والتصنيف حتى يتم اعتماد كل عنوان.' },
        { title: 'معالجة الصوت', body: 'اعتماد التراكات، معالجة الملفات، ثم اختيار العينة تفاعلياً قبل توليد الدوسيه النهائي.' },
        { title: 'الدوسيه والتسليم', body: 'يتم إنشاء ملف البيانات النهائي وملف ZIP الجاهز ثم مزامنة ClickUp بعد نجاح كل الخطوات.' },
      ]
    : [
        { title: 'Batch creation', body: 'Start from either a Google Drive folder plus workbook, or a single ZIP with manual metadata.' },
        { title: 'Intake and normalization', body: 'The source is copied into R2, inspected structurally, and grouped into workable candidates.' },
        { title: 'Metadata normalization', body: 'An unstructured Excel workbook is converted into structured rows with a normalization report for gaps and ambiguity.' },
        { title: 'Seller lock and matching', body: 'After choosing the seller from the Samawy reference database, matching and classification continue until every title is resolved.' },
        { title: 'Audio processing', body: 'Tracks are approved, audio is processed, then the sample is chosen interactively before final dossier generation.' },
        { title: 'Dossier and handoff', body: 'The final workbook and ZIP are generated, then ClickUp sync runs only after all gates pass.' },
      ];

  if (loading) {
    return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري تحميل لوحة التحكم…' : 'Loading dashboard…'}</div>;
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 text-red-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {isArabic ? 'فشل تحميل لوحة التحكم' : 'Failed to load dashboard'}: {error}
        </div>
      </div>
    );
  }

  const retained = data?.summaries.retainedStorage ?? { retainedBytes: 0, retainedObjects: 0 };
  const synced = data?.summaries.clickupSyncCounts.synced ?? 0;

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden bg-[linear-gradient(140deg,rgba(1,11,38,0.96),rgba(11,128,255,0.96))] text-white">
        <div className="grid gap-6 lg:grid-cols-[1.3fr,0.7fr]">
          <div>
            <p className="text-sm tracking-[0.2em] text-sky-100">SAMAWY AUDIOBOOK CONTROL PLANE</p>
            <h2 className="mt-4 text-4xl font-black leading-tight">
              {isArabic ? 'مرجع التشغيل الكامل لعناوين الكتب الصوتية في سماوي' : 'Operational source of truth for Samawy audiobooks'}
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-sky-50/90">
              {isArabic
                ? 'هذا التطبيق هو المصدر المرجعي للعناوين، البيانات الوصفية، حالة المعالجة، ملفات الدوسيه، وتتبع مزامنة ClickUp.'
                : 'This app is the authoritative catalog for titles, metadata, processing status, dossier assets, and ClickUp sync tracking.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/new-batch" className="btn-primary bg-white !text-[color:var(--samawy-ink)] hover:!bg-sky-50">
                {isArabic ? 'بدء دفعة جديدة' : 'Start a new batch'}
              </Link>
              <Link to="/books" className="btn-secondary border-white/20 bg-white/10 !text-white hover:!bg-white/15">
                {isArabic ? 'استعراض الكتالوج' : 'Open catalog'}
              </Link>
            </div>
          </div>
          <div className="grid gap-3 rounded-[28px] bg-white/10 p-4">
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-xs text-sky-100">{isArabic ? 'حجم الدوسيهات المحتفظ بها' : 'Retained dossier size'}</p>
              <p className="mt-2 text-2xl font-black">{formatStorageSize(retained.retainedBytes)}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-xs text-sky-100">{isArabic ? 'العناوين المتزامنة مع ClickUp' : 'Titles synced to ClickUp'}</p>
              <p className="mt-2 text-2xl font-black">{synced}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric title={isArabic ? 'إجمالي الدُفعات' : 'Total batches'} value={data?.summaries.totalBatches ?? 0} note={isArabic ? 'كل مسارات الاستقبال النشطة والمكتملة' : 'All active and completed intake flows'} icon={FolderKanban} link="/intake" />
        <Metric title={isArabic ? 'إجمالي العناوين' : 'Total books'} value={data?.summaries.totalBooks ?? 0} note={isArabic ? 'الكتالوج المرجعي داخل D1' : 'Canonical catalog stored in D1'} icon={Database} link="/books" />
        <Metric title={isArabic ? 'جاهز للتسليم' : 'Ready for handoff'} value={data?.summaries.dossierStatusCounts.ready ?? 0} note={isArabic ? 'دوسيه مكتمل وجاهز للمزامنة' : 'Dossier complete and ready to sync'} icon={CheckCircle2} link="/books" />
        <Metric title={isArabic ? 'التخزين المحتفظ به' : 'Retained storage'} value={formatStorageSize(retained.retainedBytes)} note={isArabic ? `${retained.retainedObjects} ملف نهائي` : `${retained.retainedObjects} final objects`} icon={Cloud} link="/artifacts" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <div className="card">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'شرح مسار العمل' : 'Workflow overview'}</h3>
              <p className="section-subtitle">{isArabic ? 'كل مرحلة تمنع التي تليها حتى تكتمل بنجاح أو بقرار واضح.' : 'Each stage blocks the next one until it completes successfully or reaches an explicit decision.'}</p>
            </div>
          </div>
          <div className="space-y-3">
            {flowSteps.map((step, index) => (
              <div key={step.title} className="rounded-[24px] border border-sky-100 bg-[rgba(11,128,255,0.04)] p-4">
                <div className="flex items-center gap-3">
                  <div className="step-pill">{index + 1}</div>
                  <h4 className="font-bold text-[color:var(--samawy-ink)]">{step.title}</h4>
                </div>
                <p className="mt-3 text-sm leading-7 text-[color:var(--fg-2)]">{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6">
          <div className="card">
            <div className="mb-4 flex items-center gap-2">
              <AudioLines className="h-5 w-5 text-[color:var(--samawy-blue)]" />
              <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'آخر العناوين' : 'Recent books'}</h3>
            </div>
            <div className="space-y-3">
              {(data?.audiobooks ?? []).slice(0, 5).map((book) => (
                <Link key={book.id} to={`/books/${book.id}`} className="flex items-center justify-between rounded-[20px] border border-slate-100 px-4 py-3 hover:border-sky-200">
                  <div>
                    <p className="font-semibold text-[color:var(--samawy-ink)]">{book.title}</p>
                    <p className="mt-1 text-xs text-[color:var(--fg-2)]">{book.publisherName}</p>
                  </div>
                  <div className="text-left">
                    <span className="badge-blue">{book.dossierStatus}</span>
                    <p className="mt-2 text-xs text-[color:var(--fg-2)]">ClickUp: {book.clickupSyncStatus}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="mb-4 flex items-center gap-2">
              <Link2 className="h-5 w-5 text-[color:var(--samawy-blue)]" />
              <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'صحة المزامنة' : 'Sync health'}</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(data?.summaries.clickupSyncCounts ?? {}).map(([status, count]) => (
                <div key={status} className="rounded-[20px] bg-[rgba(11,128,255,0.04)] p-4">
                  <p className="text-xs text-[color:var(--fg-2)]">{status}</p>
                  <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">{count}</p>
                </div>
              ))}
              {Object.keys(data?.summaries.clickupSyncCounts ?? {}).length === 0 && (
                <p className="text-sm text-[color:var(--fg-2)]">{isArabic ? 'لا توجد محاولات مزامنة بعد.' : 'No sync attempts yet.'}</p>
              )}
            </div>
            <div className="mt-5">
              <Link to="/analytics" className="inline-flex items-center gap-2 text-sm font-semibold text-sky-700">
                {isArabic ? 'استعراض التحليلات الكاملة' : 'Open full analytics'}
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
