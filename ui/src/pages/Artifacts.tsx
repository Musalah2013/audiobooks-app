import { useMemo, useState } from 'react';
import { AlertCircle, ChevronLeft, Download, FolderTree, HardDrive, Search } from 'lucide-react';
import { downloadFile, useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';

interface Artifact {
  id: string;
  artifactType: string;
  objectKey: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface StorageEntry {
  key: string;
  sizeBytes: number;
  uploaded: string;
}

function formatStorageSize(bytes: number) {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.max(mb, 0.01).toFixed(mb >= 10 ? 1 : 2)} MB`;
}

export default function Artifacts() {
  const [prefix, setPrefix] = useState('');
  const [pendingPrefix, setPendingPrefix] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const { addToast } = useToast();
  const { isArabic } = useLocale();

  const storage = useApi<{
    prefix: string;
    folders: string[];
    objects: StorageEntry[];
  }>(`/api/artifacts/storage?prefix=${encodeURIComponent(prefix)}`);
  const artifacts = useApi<{ artifacts: Artifact[] }>('/api/artifacts');
  const analytics = useApi<{
    retainedBytes: number;
    retainedObjects: number;
    tempBytes: number;
    tempObjects: number;
    retainedByPublisher: Record<string, { bytes: number; objects: number }>;
    retainedByType: Record<string, { bytes: number; objects: number }>;
  }>('/api/artifacts/analytics');

  const breadcrumb = useMemo(() => prefix.split('/').filter(Boolean), [prefix]);

  async function handleDownload(objectKey: string) {
    setDownloadingKey(objectKey);
    try {
      await downloadFile(objectKey);
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل تنزيل الملف' : 'Failed to download file'), 'error');
    } finally {
      setDownloadingKey(null);
    }
  }

  if (storage.loading || artifacts.loading || analytics.loading) {
    return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري تحميل بيانات التخزين…' : 'Loading storage data…'}</div>;
  }

  if (storage.error || artifacts.error || analytics.error) {
    return (
      <div className="card border-red-200 bg-red-50 text-red-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {storage.error || artifacts.error || analytics.error}
        </div>
      </div>
    );
  }

  const trackedArtifacts = artifacts.data?.artifacts ?? [];
  const storageObjects = storage.data?.objects ?? [];
  const publisherStats = analytics.data?.retainedByPublisher ?? {};
  const typeStats = analytics.data?.retainedByType ?? {};

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">{isArabic ? 'متصفح التخزين' : 'Storage browser'}</h2>
            <p className="section-subtitle">{isArabic ? 'استعراض المسارات المحتفظ بها، الملفات النهائية، والتحقق من الالتزام بسياسة التنظيف.' : 'Browse retained paths, final assets, and validate cleanup-policy compliance.'}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] bg-[rgba(11,128,255,0.05)] p-4">
              <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'حجم الدوسيهات المحتفظ بها' : 'Retained dossier size'}</p>
              <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">{formatStorageSize(analytics.data?.retainedBytes ?? 0)}</p>
            </div>
            <div className="rounded-[22px] bg-[rgba(1,11,38,0.04)] p-4">
              <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'المخلفات المؤقتة' : 'Temporary leftovers'}</p>
              <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">{formatStorageSize(analytics.data?.tempBytes ?? 0)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <FolderTree className="h-5 w-5 text-[color:var(--samawy-blue)]" />
            <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'شجرة المسارات' : 'Path tree'}</h3>
          </div>
          <div className="flex gap-3">
            <input className="input" value={pendingPrefix} onChange={(e) => setPendingPrefix(e.target.value)} placeholder={isArabic ? 'ابدأ من مسار محدد' : 'Start from a specific prefix'} />
            <button type="button" className="btn-secondary" onClick={() => setPrefix(pendingPrefix.trim())}>
              <Search className="h-4 w-4" />
              {isArabic ? 'فتح' : 'Open'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="step-pill" onClick={() => setPrefix('')}>{isArabic ? 'الجذر' : 'Root'}</button>
            {breadcrumb.map((part, index) => {
              const nextPrefix = breadcrumb.slice(0, index + 1).join('/');
              return (
                <button type="button" key={nextPrefix} className="step-pill" onClick={() => setPrefix(nextPrefix)}>
                  {part}
                </button>
              );
            })}
          </div>
          <div className="table-shell divide-y divide-slate-100">
            {(storage.data?.folders ?? []).map((folder) => (
              <button
                type="button"
                key={folder}
                onClick={() => setPrefix(folder.replace(/\/$/, ''))}
                className="flex w-full items-center justify-between px-4 py-3 text-right hover:bg-[rgba(11,128,255,0.04)]"
              >
                <span className="font-medium text-[color:var(--samawy-ink)]">{folder.replace(prefix, '').replace(/^\/+/, '')}</span>
                <ChevronLeft className="h-4 w-4 text-[color:var(--fg-2)]" />
              </button>
            ))}
            {storageObjects.map((object) => (
              <div key={object.key} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-[color:var(--samawy-ink)]">{object.key.split('/').pop()}</p>
                  <p className="mt-1 text-xs text-[color:var(--fg-2)]">{formatStorageSize(object.sizeBytes)}</p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => handleDownload(object.key)} disabled={downloadingKey === object.key}>
                  <Download className="h-4 w-4" />
                  {downloadingKey === object.key ? (isArabic ? 'جاري التنزيل…' : 'Downloading…') : (isArabic ? 'تنزيل' : 'Download')}
                </button>
              </div>
            ))}
            {(storage.data?.folders.length ?? 0) === 0 && storageObjects.length === 0 && (
              <div className="px-4 py-8 text-sm text-[color:var(--fg-2)]">{isArabic ? 'لا توجد عناصر في هذا المسار.' : 'No items under this prefix.'}</div>
            )}
          </div>
        </div>

        <div className="grid gap-6">
          <div className="card">
            <div className="mb-4 flex items-center gap-3">
              <HardDrive className="h-5 w-5 text-[color:var(--samawy-blue)]" />
              <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'الاحتفاظ حسب الناشر' : 'Retention by publisher'}</h3>
            </div>
            <div className="space-y-3">
              {Object.entries(publisherStats).map(([publisher, summary]) => (
                <div key={publisher} className="rounded-[22px] bg-[rgba(11,128,255,0.04)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[color:var(--samawy-ink)]">{publisher}</p>
                    <p className="text-sm text-[color:var(--fg-2)]">{summary.objects} {isArabic ? 'ملف' : 'objects'}</p>
                  </div>
                  <p className="mt-2 text-sm text-sky-700">{formatStorageSize(summary.bytes)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-4 text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'سجل الملفات المرجعي' : 'Canonical artifact registry'}</h3>
            <div className="space-y-3">
              {trackedArtifacts.slice(0, 8).map((artifact) => (
                <div key={artifact.id} className="rounded-[20px] border border-slate-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[color:var(--samawy-ink)]">{artifact.artifactType}</p>
                      <p className="mt-1 text-xs text-[color:var(--fg-2)]">{artifact.objectKey}</p>
                    </div>
                    <p className="text-xs text-[color:var(--fg-2)]">{artifact.sizeBytes ? formatStorageSize(artifact.sizeBytes) : '—'}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {Object.entries(typeStats).map(([type, summary]) => (
                <span key={type} className="badge-gray">{type}: {formatStorageSize(summary.bytes)}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
