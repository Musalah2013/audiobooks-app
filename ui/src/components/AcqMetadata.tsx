import { useLocale } from '../hooks/useLocale';

// Optional nice bilingual labels for known keys. Anything NOT listed falls back
// to a humanized version of the raw key, so new acquisition fields show up
// automatically without touching this component.
const LABELS: Record<string, { ar: string; en: string }> = {
  sellerName: { ar: 'الناشر', en: 'Publisher' },
  title: { ar: 'العنوان', en: 'Title' },
  subtitle: { ar: 'العنوان الفرعي', en: 'Subtitle' },
  author: { ar: 'المؤلف', en: 'Author' },
  narrator: { ar: 'الراوي', en: 'Narrator' },
  isbn: { ar: 'ردمك', en: 'ISBN' },
  genre: { ar: 'النوع', en: 'Genre' },
  blurb: { ar: 'نبذة', en: 'Blurb' },
  pubYear: { ar: 'سنة النشر', en: 'Pub year' },
  sellingType: { ar: 'نوع البيع', en: 'Selling type' },
  price: { ar: 'السعر', en: 'Price' },
};

// Internal keys not meant for display.
const HIDDEN = new Set(['sellerId']);

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatValue(key: string, value: unknown, isArabic: boolean): string {
  if (key === 'sellingType') {
    if (value === 'subscription') return isArabic ? 'اشتراك' : 'Subscription';
    if (value === 'a_la_carte') return isArabic ? 'شراء منفرد' : 'A la carte';
  }
  if (typeof value === 'boolean') return value ? (isArabic ? 'نعم' : 'Yes') : (isArabic ? 'لا' : 'No');
  return String(value);
}

/** Renders whatever metadata the acquisition team entered as a label/value list,
 *  with no hardcoded field list — it adapts to whatever keys are present. */
export function AcqMetadata({ data, className = '' }: { data: unknown; className?: string }) {
  const { isArabic } = useLocale();
  if (!data || typeof data !== 'object') return null;
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([k, v]) => !HIDDEN.has(k) && v !== null && v !== undefined && String(v).trim() !== '',
  );
  if (entries.length === 0) return null;
  return (
    <div className={`grid gap-x-4 gap-y-1 text-xs ${className}`} style={{ gridTemplateColumns: 'auto minmax(0,1fr)' }}>
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-slate-500 font-medium whitespace-nowrap">
            {(LABELS[k] ? (isArabic ? LABELS[k].ar : LABELS[k].en) : humanize(k))}:
          </span>
          <span className="text-slate-800 break-words">{formatValue(k, v, isArabic)}</span>
        </div>
      ))}
    </div>
  );
}
