import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, Download, Eye, EyeOff, RefreshCw, Settings as SettingsIcon, Sliders, Trash2 } from 'lucide-react';
import { apiRequest, useApi } from '../hooks/useApi';
import { InlineError } from '../components/InlineError';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { ClickUpConfig, ClickUpFieldMappings, ClickUpSettingsResponse, AppSettings } from '@api';

function formatStorageSize(bytes: number) {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.max(mb, 0.01).toFixed(mb >= 10 ? 1 : 2)} MB`;
}

const FIELD_LABELS: Record<keyof ClickUpFieldMappings, string> = {
  audiobookTitle: 'Audiobook Title', subtitle: 'Subtitle', publisher: 'Publisher',
  author: 'Author', narrator: 'Narrator', isbn: 'ISBN', pubYear: 'Publication Year',
  genre: 'Genre', blurb: 'Description / Blurb', classification: 'Classification',
  processingStatus: 'Processing Status', dossierStatus: 'Dossier Status',
  trackCount: 'Track Count', totalLengthHours: 'Total Length (hours)',
  importancePoints: 'Importance Points', driveUrl: 'Source Drive URL', sellingPrice: 'Selling Price',
  appLink: 'App Link (ops URL)', workbookUrl: 'Dossier Workbook URL', audioZipUrl: 'Final Audio ZIP URL',
};

const METADATA_FIELDS: Array<keyof ClickUpFieldMappings> = [
  'audiobookTitle', 'subtitle', 'publisher', 'author', 'narrator',
  'isbn', 'pubYear', 'genre', 'blurb', 'classification',
  'processingStatus', 'dossierStatus', 'trackCount', 'totalLengthHours',
  'importancePoints', 'driveUrl', 'sellingPrice',
];

const DESCRIPTION_FIELDS: Array<keyof ClickUpFieldMappings> = ['appLink', 'workbookUrl', 'audioZipUrl'];

export default function Settings() {
  const { data, loading, error, errorDetail } = useApi<AppSettings>('/api/settings');
  const { data: cuData, loading: cuLoading, refetch: cuRefetch } = useApi<ClickUpSettingsResponse>('/api/settings/clickup');
  const [cuSaving, setCuSaving] = useState(false);
  const [cuResetting, setCuResetting] = useState(false);
  const [cuForm, setCuForm] = useState<ClickUpConfig | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenClearing, setTokenClearing] = useState(false);
  const [cuFields, setCuFields] = useState<Array<{ id: string; name: string; type: string }> | null>(null);
  const [cuFieldsFetching, setCuFieldsFetching] = useState(false);
  const { addToast } = useToast();
  const { isArabic } = useLocale();

  useEffect(() => {
    if (cuData?.config && !cuForm) setCuForm(cuData.config);
  }, [cuData?.config]);

  async function saveCuConfig() {
    if (!cuForm) return;
    setCuSaving(true);
    try {
      await apiRequest('/api/settings/clickup', { method: 'PATCH', body: cuForm });
      addToast(isArabic ? 'تم حفظ إعدادات ClickUp.' : 'ClickUp settings saved.', 'success');
      cuRefetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحفظ' : 'Failed to save'), 'error');
    } finally {
      setCuSaving(false);
    }
  }

  async function resetCuConfig() {
    setCuResetting(true);
    try {
      const result = await apiRequest<ClickUpSettingsResponse>('/api/settings/clickup/reset', { method: 'POST' });
      setCuForm(result.config);
      addToast(isArabic ? 'تمت إعادة تعيين إعدادات ClickUp للقيم الافتراضية.' : 'ClickUp settings reset to defaults.', 'success');
      cuRefetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل إعادة التعيين' : 'Failed to reset'), 'error');
    } finally {
      setCuResetting(false);
    }
  }

  async function fetchCuFields() {
    if (!cuForm?.listId) return;
    setCuFieldsFetching(true);
    try {
      const result = await apiRequest<{ fields: Array<{ id: string; name: string; type: string }> }>(
        `/api/settings/clickup/fields?listId=${encodeURIComponent(cuForm.listId)}`,
        { method: 'GET' },
      );
      setCuFields(result.fields);
      addToast(isArabic ? `تم جلب ${result.fields.length} حقلاً من ClickUp.` : `Fetched ${result.fields.length} fields from ClickUp.`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل جلب الحقول' : 'Failed to fetch fields'), 'error');
    } finally {
      setCuFieldsFetching(false);
    }
  }

  async function saveToken() {
    if (!tokenInput.trim()) return;
    setTokenSaving(true);
    try {
      await apiRequest('/api/settings/clickup/token', { method: 'PUT', body: { token: tokenInput.trim() } });
      setTokenInput('');
      addToast(isArabic ? 'تم حفظ رمز API.' : 'API token saved.', 'success');
      cuRefetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل الحفظ' : 'Failed to save token'), 'error');
    } finally {
      setTokenSaving(false);
    }
  }

  async function clearToken() {
    setTokenClearing(true);
    try {
      await apiRequest('/api/settings/clickup/token', { method: 'DELETE' });
      addToast(isArabic ? 'تم مسح رمز API من قاعدة البيانات.' : 'API token cleared from database.', 'success');
      cuRefetch();
    } catch (err) {
      addToast(err instanceof Error ? err : (isArabic ? 'فشل المسح' : 'Failed to clear token'), 'error');
    } finally {
      setTokenClearing(false);
    }
  }

  function setFieldMapping(key: keyof ClickUpFieldMappings, value: string) {
    setCuForm((prev) => prev ? { ...prev, fieldMappings: { ...prev.fieldMappings, [key]: value } } : prev);
  }

  function setDescTemplate(key: keyof ClickUpConfig['descriptionTemplate'], value: boolean) {
    setCuForm((prev) => prev ? { ...prev, descriptionTemplate: { ...prev.descriptionTemplate, [key]: value } } : prev);
  }

  if (loading) return <div className="card text-center text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري تحميل الإعدادات…' : 'Loading settings…'}</div>;
  if (error) return <InlineError message={`${isArabic ? 'فشل تحميل الإعدادات' : 'Failed to load settings'}: ${error}`} detail={errorDetail ?? undefined} />;

  return (
    <div className="space-y-6">

      {/* Header */}
      <section className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[rgba(11,128,255,0.08)] p-3 text-[color:var(--samawy-blue)]">
              <SettingsIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="section-title">{isArabic ? 'الإعدادات والتكلفة' : 'Settings and cost'}</h2>
              <p className="section-subtitle">{isArabic ? 'بيئة النظام، تكلفة التخزين التقديرية، وتسعير Cloudflare الرسمي.' : 'System environment, estimated storage cost, and official Cloudflare pricing.'}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Storage cost */}
      <section className="grid gap-6 xl:grid-cols-[1fr,1fr]">
        <div className="card space-y-5">
          <div className="flex items-center gap-3">
            <Cloud className="h-5 w-5 text-[color:var(--samawy-blue)]" />
            <h3 className="text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'تكلفة تخزين كتب الصوت' : 'Audiobook storage cost'}</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[22px] bg-[rgba(11,128,255,0.04)] p-4">
              <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'التخزين المحتفظ به' : 'Retained storage'}</p>
              <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">{formatStorageSize(data?.storage.retainedBytes ?? 0)}</p>
              <p className="mt-2 text-xs text-[color:var(--fg-2)]">{data?.storage.retainedObjects ?? 0} {isArabic ? 'ملف نهائي' : 'final objects'}</p>
            </div>
            <div className="rounded-[22px] bg-[rgba(1,11,38,0.04)] p-4">
              <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? 'التقدير الشهري' : 'Monthly estimate'}</p>
              <p className="mt-2 text-2xl font-black text-[color:var(--samawy-ink)]">${(data?.storage.estimatedMonthlyStorageCostUsd ?? 0).toFixed(4)}</p>
              <p className="mt-2 text-xs text-[color:var(--fg-2)]">{isArabic ? 'تقدير تخزين فقط دون تكلفة العمليات' : 'Storage-only estimate, excluding operation costs'}</p>
            </div>
          </div>
          <div className="rounded-[22px] border border-slate-100 p-4 text-sm leading-7 text-[color:var(--fg-2)]">
            <p>{isArabic ? 'اسم البَكِت' : 'Bucket name'}: <span className="font-semibold text-[color:var(--samawy-ink)]">{data?.environment.bucketName}</span></p>
            <p>{isArabic ? 'فئة التسعير المعتمدة' : 'Pricing assumption'}: <span className="font-semibold text-[color:var(--samawy-ink)]">R2 Standard</span></p>
            <p>{isArabic ? 'التحقق من الأسعار' : 'Pricing verified at'}: <span className="font-semibold text-[color:var(--samawy-ink)]">{data?.pricing.verifiedAt}</span></p>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-4 text-xl font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'مرجع تسعير Cloudflare R2' : 'Cloudflare R2 pricing reference'}</h3>
          <div className="table-shell">
            <div className="grid grid-cols-2 gap-px bg-slate-100 text-sm">
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">Standard storage</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">${data?.pricing.standardStorageUsdPerGbMonth} / GB-month</div>
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">Infrequent Access storage</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">${data?.pricing.infrequentAccessStorageUsdPerGbMonth} / GB-month</div>
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">Class A operations</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">${data?.pricing.classAUsdPerMillion.standard} / million</div>
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">Class B operations</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">${data?.pricing.classBUsdPerMillion.standard} / million</div>
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">IA retrieval</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">${data?.pricing.retrievalUsdPerGb.infrequentAccess} / GB</div>
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">Free tier storage</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">{data?.pricing.freeTier.storageGbMonth} GB-month</div>
              <div className="bg-white px-4 py-3 text-[color:var(--fg-2)]">Egress</div>
              <div className="bg-white px-4 py-3 font-semibold text-[color:var(--samawy-ink)]">{data?.pricing.freeTier.egress}</div>
            </div>
          </div>
          <a href={data?.pricing.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-semibold text-sky-700">
            {isArabic ? 'فتح مرجع Cloudflare الرسمي' : 'Open official Cloudflare pricing reference'}
          </a>
        </div>
      </section>

      {/* ClickUp configuration */}
      <section className="card space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[rgba(11,128,255,0.08)] p-3 text-[color:var(--samawy-blue)]">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h2 className="section-title">ClickUp {isArabic ? 'إعدادات التكامل' : 'Integration Settings'}</h2>
              <p className="section-subtitle">
                {isArabic ? 'تكوين قائمة ClickUp وربط حقول البيانات الوصفية.' : 'Configure the ClickUp list and map metadata fields to custom field IDs.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="btn-secondary text-xs px-3 py-1.5"
              disabled={cuResetting}
              title={isArabic ? 'أعد تعيين جميع الإعدادات للقيم الافتراضية' : 'Reset all settings to factory defaults'}
              onClick={resetCuConfig}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isArabic ? 'إعادة تعيين للافتراضي' : 'Reset to defaults'}
            </button>
            <button
              type="button"
              className="btn-primary text-xs px-3 py-1.5"
              disabled={cuSaving || !cuForm}
              title={isArabic ? 'احفظ إعدادات ClickUp' : 'Save ClickUp settings'}
              onClick={saveCuConfig}
            >
              {cuSaving ? (isArabic ? 'جاري الحفظ…' : 'Saving…') : (isArabic ? 'حفظ الإعدادات' : 'Save settings')}
            </button>
          </div>
        </div>

        {cuLoading && <p className="text-sm text-[color:var(--fg-2)]">{isArabic ? 'جاري التحميل…' : 'Loading…'}</p>}

        {cuData && cuForm && (
          <div className="space-y-6">

            {/* API Token */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] block mb-0.5">
                    {isArabic ? 'رمز API لـ ClickUp' : 'ClickUp API Token'}
                  </span>
                  {cuData.tokenMasked
                    ? <span className="text-xs text-emerald-700 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {cuData.tokenSource === 'db'
                          ? (isArabic ? `رمز محفوظ في قاعدة البيانات: ${cuData.tokenMasked}` : `DB token active: ${cuData.tokenMasked}`)
                          : (isArabic ? `رمز متغير البيئة: ${cuData.tokenMasked}` : `Env var token active: ${cuData.tokenMasked}`)
                        }
                      </span>
                    : <span className="text-xs text-amber-700 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {isArabic ? 'لا يوجد رمز — المزامنات ستُنشئ مهام وهمية فقط' : 'No token configured — syncs will create stubs'}
                      </span>
                  }
                </div>
                {cuData.tokenSource === 'db' && (
                  <button
                    type="button"
                    className="btn-danger text-xs px-2.5 py-1"
                    disabled={tokenClearing}
                    title={isArabic ? 'احذف الرمز المحفوظ في قاعدة البيانات (سيُستخدم متغير البيئة إن وُجد)' : 'Remove DB token (env var will be used if present)'}
                    onClick={clearToken}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {tokenClearing ? (isArabic ? 'جاري المسح…' : 'Clearing…') : (isArabic ? 'مسح الرمز' : 'Clear token')}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={tokenVisible ? 'text' : 'password'}
                    className="input font-mono text-sm pr-10"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={cuData.tokenMasked ? (isArabic ? 'أدخل رمزاً جديداً للاستبدال…' : 'Enter new token to replace…') : (isArabic ? 'pk_xxxxxx…' : 'pk_xxxxxx…')}
                    title={isArabic ? 'رمز الوصول لـ ClickUp API' : 'ClickUp API personal token'}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 flex items-center text-[color:var(--fg-2)] hover:text-[color:var(--samawy-ink)]"
                    onClick={() => setTokenVisible((v) => !v)}
                    title={tokenVisible ? (isArabic ? 'إخفاء الرمز' : 'Hide token') : (isArabic ? 'إظهار الرمز' : 'Show token')}
                  >
                    {tokenVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-primary text-xs px-3"
                  disabled={tokenSaving || !tokenInput.trim()}
                  title={isArabic ? 'احفظ الرمز في قاعدة البيانات' : 'Save token to database'}
                  onClick={saveToken}
                >
                  {tokenSaving ? (isArabic ? 'جاري الحفظ…' : 'Saving…') : (isArabic ? 'حفظ' : 'Save')}
                </button>
              </div>
            </div>

            {/* List ID + status + behavior */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div />
              <div className="space-y-3">
                <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-1.5 block">
                  {isArabic ? 'معرّف القائمة' : 'List ID'}
                </span>
                <div className="flex gap-2">
                  <input
                    className="input font-mono text-sm flex-1"
                    value={cuForm.listId}
                    onChange={(e) => { setCuForm((prev) => prev ? { ...prev, listId: e.target.value } : prev); setCuFields(null); }}
                    placeholder="901211916918"
                    title={isArabic ? 'معرّف قائمة ClickUp التي ستُنشأ فيها المهام' : 'The ClickUp list ID where tasks will be created'}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs px-2.5 shrink-0"
                    disabled={cuFieldsFetching || !cuForm.listId}
                    title={isArabic ? 'جلب الحقول المخصصة من القائمة' : 'Fetch custom fields from this list'}
                    onClick={fetchCuFields}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {cuFieldsFetching ? (isArabic ? 'جاري الجلب…' : 'Fetching…') : (isArabic ? 'جلب الحقول' : 'Fetch fields')}
                  </button>
                </div>
                {cuFields && (
                  <p className="mt-1 text-xs text-emerald-700">{isArabic ? `${cuFields.length} حقلاً — استخدم القوائم المنسدلة أدناه` : `${cuFields.length} fields loaded — use dropdowns below`}</p>
                )}
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] mb-1.5 block">
                    {isArabic ? 'اسم الحالة' : 'Status Name'}
                  </span>
                  <input
                    className="input text-sm w-full"
                    value={cuForm.statusName}
                    onChange={(e) => setCuForm((prev) => prev ? { ...prev, statusName: e.target.value } : prev)}
                    placeholder={isArabic ? 'مثال: جاهز للنشر' : 'e.g. ready for publishing'}
                    title={isArabic ? 'اسم الحالة التي ستُعيَّن للمهمة عند المزامنة (اتركه فارغاً لعدم تغيير الحالة)' : 'Status name to set on the task when syncing — leave empty to keep default status'}
                  />
                </div>
              </div>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer" title={isArabic ? 'إذا كانت المهمة موجودة بالفعل، حدّثها بدلاً من إنشاء واحدة جديدة' : 'If a task already exists for this book, update it instead of creating a duplicate'}>
                  <input type="checkbox" className="accent-[color:var(--samawy-blue)]" checked={cuForm.updateExistingTask} onChange={(e) => setCuForm((prev) => prev ? { ...prev, updateExistingTask: e.target.checked } : prev)} />
                  <span className="text-sm">{isArabic ? 'تحديث المهمة الموجودة عند إعادة المزامنة' : 'Update existing task on re-sync'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" title={isArabic ? 'إرفاق صورة الغلاف بمهمة ClickUp تلقائياً عند المزامنة' : 'Automatically attach the cover image to the ClickUp task when syncing'}>
                  <input type="checkbox" className="accent-[color:var(--samawy-blue)]" checked={cuForm.attachCover} onChange={(e) => setCuForm((prev) => prev ? { ...prev, attachCover: e.target.checked } : prev)} />
                  <span className="text-sm">{isArabic ? 'إرفاق صورة الغلاف بالمهمة' : 'Attach cover image to task'}</span>
                </label>
              </div>
            </div>

            {/* Description template */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'محتوى وصف المهمة' : 'Task description content'}</h4>
              <p className="text-xs text-[color:var(--fg-2)]">
                {isArabic ? 'اختر ما يُضمَّن في نص وصف مهمة ClickUp. يمكنك أيضاً ربط هذه القيم بحقول مخصصة في الجدول أدناه.' : 'Choose what appears in the ClickUp task description body. You can also map these values to custom fields in the table below.'}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(
                  [
                    ['includeAppLink', isArabic ? 'رابط التطبيق' : 'App link'],
                    ['includeWorkbookUrl', isArabic ? 'رابط ملف Excel' : 'Workbook URL'],
                    ['includeAudioZipUrl', isArabic ? 'رابط ملف ZIP' : 'Audio ZIP URL'],
                    ['includeClassification', isArabic ? 'التصنيف' : 'Classification'],
                    ['includeCoverStatus', isArabic ? 'حالة الغلاف' : 'Cover status'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer rounded-[10px] border border-slate-200 px-3 py-2 hover:border-slate-300">
                    <input
                      type="checkbox"
                      className="accent-[color:var(--samawy-blue)]"
                      checked={cuForm.descriptionTemplate[key]}
                      onChange={(e) => setDescTemplate(key, e.target.checked)}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Field mappings — metadata fields */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'ربط حقول البيانات الوصفية' : 'Metadata field mappings'}</h4>
              <p className="text-xs text-[color:var(--fg-2)]">
                {isArabic ? 'أدخل معرّف الحقل المخصص في ClickUp لكل حقل. اتركه فارغاً لتجاهل الحقل.' : 'Enter the ClickUp custom field ID for each field. Leave blank to skip that field.'}
              </p>
              <div className="rounded-[14px] border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[1fr,1.5fr] bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] px-4 py-2.5 gap-4">
                  <span>{isArabic ? 'الحقل' : 'Field'}</span>
                  <span>{cuFields ? (isArabic ? 'الحقل المخصص في ClickUp' : 'ClickUp Custom Field') : (isArabic ? 'معرّف الحقل في ClickUp' : 'ClickUp Field ID')}</span>
                </div>
                {METADATA_FIELDS.map((key, i) => (
                  <div key={key} className={`grid grid-cols-[1fr,1.5fr] gap-4 px-4 py-2.5 items-center ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <span className="text-sm text-[color:var(--samawy-ink)]">{FIELD_LABELS[key]}</span>
                    {cuFields ? (
                      <select
                        className="input text-sm py-1.5"
                        value={cuForm.fieldMappings[key]}
                        onChange={(e) => setFieldMapping(key, e.target.value)}
                        title={FIELD_LABELS[key]}
                      >
                        <option value="">{isArabic ? '— لا تُرسَل —' : '— skip —'}</option>
                        {cuFields.map((f) => (
                          <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input font-mono text-xs py-1.5"
                        value={cuForm.fieldMappings[key]}
                        onChange={(e) => setFieldMapping(key, e.target.value)}
                        placeholder={isArabic ? 'معرّف الحقل…' : 'field-uuid…'}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Field mappings — description-content fields */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'ربط محتوى الوصف بحقول مخصصة' : 'Map description content to custom fields'}</h4>
              <p className="text-xs text-[color:var(--fg-2)]">
                {isArabic ? 'هذه القيم تظهر في نص الوصف بشكل افتراضي. إذا أدخلت معرّف حقل مخصص هنا، ستُرسَل القيمة أيضاً إلى ذلك الحقل.' : 'These values appear in the description text by default. If you enter a custom field ID here, the value is also pushed to that field.'}
              </p>
              <div className="rounded-[14px] border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[1fr,1.5fr] bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)] px-4 py-2.5 gap-4">
                  <span>{isArabic ? 'الحقل' : 'Field'}</span>
                  <span>{cuFields ? (isArabic ? 'الحقل المخصص في ClickUp (اختياري)' : 'ClickUp Custom Field (optional)') : (isArabic ? 'معرّف الحقل في ClickUp (اختياري)' : 'ClickUp Field ID (optional)')}</span>
                </div>
                {DESCRIPTION_FIELDS.map((key, i) => (
                  <div key={key} className={`grid grid-cols-[1fr,1.5fr] gap-4 px-4 py-2.5 items-center ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <span className="text-sm text-[color:var(--samawy-ink)]">{FIELD_LABELS[key]}</span>
                    {cuFields ? (
                      <select
                        className="input text-sm py-1.5"
                        value={cuForm.fieldMappings[key]}
                        onChange={(e) => setFieldMapping(key, e.target.value)}
                        title={FIELD_LABELS[key]}
                      >
                        <option value="">{isArabic ? '— لا تُرسَل لحقل —' : '— description only —'}</option>
                        {cuFields.map((f) => (
                          <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input font-mono text-xs py-1.5"
                        value={cuForm.fieldMappings[key]}
                        onChange={(e) => setFieldMapping(key, e.target.value)}
                        placeholder={isArabic ? 'فارغ = لا تُرسَل لحقل' : 'empty = description only'}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </section>

    </div>
  );
}
