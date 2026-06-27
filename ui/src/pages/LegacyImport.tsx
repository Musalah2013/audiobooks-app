import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Search, CheckCircle2, AlertCircle, FileSpreadsheet, X } from 'lucide-react';
import { apiRequest } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { Seller } from '@api';

interface LegacyRow {
  title: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  isbn?: string;
  genre?: string;
  blurb?: string;
  pubYear?: string;
  sellingType?: string;
  price?: number;
  trackCount?: number;
  totalHours?: number;
}

// Header aliases → canonical field
const COLUMN_MAP: Record<string, keyof LegacyRow> = {
  title: 'title', 'book title': 'title', name: 'title', العنوان: 'title', 'اسم الكتاب': 'title',
  subtitle: 'subtitle', 'العنوان الفرعي': 'subtitle',
  author: 'author', المؤلف: 'author',
  narrator: 'narrator', الراوي: 'narrator', القارئ: 'narrator',
  isbn: 'isbn', ردمك: 'isbn',
  genre: 'genre', النوع: 'genre', التصنيف: 'genre',
  blurb: 'blurb', description: 'blurb', نبذة: 'blurb', الوصف: 'blurb',
  'pub year': 'pubYear', pubyear: 'pubYear', year: 'pubYear', 'سنة النشر': 'pubYear',
  'selling type': 'sellingType', sellingtype: 'sellingType', 'نوع البيع': 'sellingType',
  price: 'price', السعر: 'price',
  'track count': 'trackCount', trackcount: 'trackCount', tracks: 'trackCount', 'عدد المقاطع': 'trackCount',
  'total hours': 'totalHours', totalhours: 'totalHours', hours: 'totalHours', 'الساعات': 'totalHours', 'عدد الساعات': 'totalHours',
};

// Minimal CSV/TSV parser supporting quoted fields.
function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const delim = text.includes('\t') && !text.includes(',') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function rowsToBooks(text: string): { books: LegacyRow[]; unmapped: string[] } {
  const grid = parseDelimited(text);
  if (grid.length < 2) return { books: [], unmapped: [] };
  const headers = grid[0].map((h) => h.trim().toLowerCase());
  const mapped = headers.map((h) => COLUMN_MAP[h]);
  const unmapped = headers.filter((h, i) => h && !mapped[i]);
  const books: LegacyRow[] = [];
  for (const r of grid.slice(1)) {
    const obj: Record<string, unknown> = {};
    mapped.forEach((field, i) => {
      if (!field) return;
      const raw = (r[i] ?? '').trim();
      if (raw === '') return;
      if (field === 'price' || field === 'trackCount' || field === 'totalHours') {
        const n = Number(raw.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(n)) obj[field] = n;
      } else obj[field] = raw;
    });
    if (obj.title) books.push(obj as unknown as LegacyRow);
  }
  return { books, unmapped };
}

export default function LegacyImport() {
  const { addToast } = useToast();
  const { isArabic } = useLocale();

  const [sellerQuery, setSellerQuery] = useState('');
  const [sellerResults, setSellerResults] = useState<Seller[]>([]);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [searching, setSearching] = useState(false);

  const [raw, setRaw] = useState('');
  const [books, setBooks] = useState<LegacyRow[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ batchId: string; created: number } | null>(null);

  async function searchSellers() {
    setSearching(true);
    try {
      const res = await apiRequest<{ sellers: Seller[] }>(`/api/sellers?q=${encodeURIComponent(sellerQuery)}`);
      setSellerResults(res.sellers);
    } catch (err) {
      addToast(err instanceof Error ? err : 'Search failed', 'error');
    } finally { setSearching(false); }
  }

  function reparse(text: string) {
    setRaw(text);
    const { books, unmapped } = rowsToBooks(text);
    setBooks(books);
    setUnmapped(unmapped);
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => reparse(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function commit() {
    if (!seller || books.length === 0) return;
    setImporting(true);
    try {
      const res = await apiRequest<{ batchId: string; created: number }>('/api/books/legacy-import', {
        method: 'POST',
        body: { sellerId: seller.id, sellerName: seller.name, books },
      });
      setDone(res);
      addToast(isArabic ? `تم استيراد ${res.created} كتاباً.` : `Imported ${res.created} books.`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err : 'Import failed', 'error');
    } finally { setImporting(false); }
  }

  if (done) {
    return (
      <div className="space-y-6">
        <section className="card text-center py-10">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="section-title">{isArabic ? 'اكتمل الاستيراد' : 'Import complete'}</h2>
          <p className="section-subtitle">{isArabic ? `تمت إضافة ${done.created} كتاباً قديماً إلى الفهرس.` : `${done.created} legacy books added to the catalog.`}</p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link to="/books" className="btn-primary">{isArabic ? 'عرض الكتب' : 'View books'}</Link>
            <button type="button" className="btn-secondary" onClick={() => { setDone(null); setRaw(''); setBooks([]); setSeller(null); }}>{isArabic ? 'استيراد آخر' : 'Import more'}</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="card">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-stone-200 p-3 text-stone-600"><Upload className="h-5 w-5" /></div>
          <div>
            <h2 className="section-title">{isArabic ? 'استيراد الكتب القديمة' : 'Legacy book import'}</h2>
            <p className="section-subtitle">{isArabic ? 'استيراد لمرة واحدة لكتب أُنتجت ودُمجت مسبقاً في نظام الكتب الصوتية — بدون معالجة أو مزامنة.' : 'One-time import of books already produced and live in the audiobooks system — no processing, no sync.'}</p>
          </div>
        </div>
      </section>

      {/* Step 1: publisher */}
      <section className="card space-y-3">
        <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? '١. الناشر' : '1. Publisher'}</h3>
        {seller ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <span className="text-sm font-semibold text-emerald-800">{seller.name} <span className="text-xs opacity-70">#{seller.id}</span></span>
            <button type="button" className="text-emerald-700 hover:text-emerald-900" onClick={() => setSeller(null)}><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input className="input flex-1" value={sellerQuery} onChange={(e) => setSellerQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchSellers()} placeholder={isArabic ? 'ابحث عن ناشر…' : 'Search publisher…'} />
              <button type="button" className="btn-secondary" disabled={searching} onClick={searchSellers}><Search className="h-4 w-4" />{isArabic ? 'بحث' : 'Search'}</button>
            </div>
            {sellerResults.length > 0 && (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {sellerResults.map((s) => (
                  <button key={s.id} type="button" className="w-full text-start px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between" onClick={() => { setSeller(s); setSellerResults([]); }}>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-[color:var(--fg-2)]">#{s.id}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Step 2: data */}
      <section className="card space-y-3">
        <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? '٢. البيانات' : '2. Book data'}</h3>
        <p className="text-xs text-[color:var(--fg-2)]">
          {isArabic ? 'الصق صفوف CSV/TSV (سطر العناوين أولاً) أو ارفع ملفاً. الأعمدة المدعومة: ' : 'Paste CSV/TSV rows (header row first) or upload a file. Supported columns: '}
          <code className="font-mono text-[11px]">title, subtitle, author, narrator, isbn, genre, blurb, pub_year, selling_type, price, track_count, total_hours</code>
        </p>
        <div className="flex items-center gap-2">
          <label className="btn-secondary text-xs cursor-pointer">
            <FileSpreadsheet className="h-3.5 w-3.5" />{isArabic ? 'رفع CSV' : 'Upload CSV'}
            <input type="file" accept=".csv,.tsv,text/csv,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </label>
          {books.length > 0 && <span className="text-xs text-emerald-700 font-semibold">{books.length} {isArabic ? 'كتاب جاهز' : 'books parsed'}</span>}
        </div>
        <textarea
          className="input w-full font-mono text-xs min-h-[160px]"
          value={raw}
          onChange={(e) => reparse(e.target.value)}
          placeholder={'title,author,narrator,isbn,total_hours\nThe Example,Author Name,Narrator,9781234567890,6.5'}
        />
        {unmapped.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {isArabic ? 'أعمدة غير معروفة سيتم تجاهلها: ' : 'Unrecognized columns (ignored): '}<strong>{unmapped.join(', ')}</strong>
          </div>
        )}
      </section>

      {/* Preview */}
      {books.length > 0 && (
        <section className="card space-y-3">
          <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? '٣. معاينة' : '3. Preview'} <span className="text-xs font-normal text-[color:var(--fg-2)]">({books.length})</span></h3>
          <div className="table-shell">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-start text-xs uppercase tracking-wide text-[color:var(--fg-2)]">
                  <th className="px-3 py-2 text-start">{isArabic ? 'العنوان' : 'Title'}</th>
                  <th className="px-3 py-2 text-start">{isArabic ? 'المؤلف' : 'Author'}</th>
                  <th className="px-3 py-2 text-start">{isArabic ? 'الراوي' : 'Narrator'}</th>
                  <th className="px-3 py-2 text-start">ISBN</th>
                  <th className="px-3 py-2 text-end">{isArabic ? 'ساعات' : 'Hours'}</th>
                </tr>
              </thead>
              <tbody>
                {books.slice(0, 50).map((b, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{b.title}</td>
                    <td className="px-3 py-2 text-[color:var(--fg-2)]">{b.author ?? '—'}</td>
                    <td className="px-3 py-2 text-[color:var(--fg-2)]">{b.narrator ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[color:var(--fg-2)]">{b.isbn ?? '—'}</td>
                    <td className="px-3 py-2 text-end">{b.totalHours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {books.length > 50 && <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? `+ ${books.length - 50} صفوف أخرى` : `+ ${books.length - 50} more rows`}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn-primary" disabled={!seller || importing} onClick={commit}>
              <Upload className="h-4 w-4" />
              {importing ? (isArabic ? 'جاري الاستيراد…' : 'Importing…') : (isArabic ? `استيراد ${books.length} كتاباً` : `Import ${books.length} books`)}
            </button>
          </div>
          {!seller && <p className="text-xs text-amber-600 text-end">{isArabic ? 'اختر الناشر أولاً.' : 'Select a publisher first.'}</p>}
        </section>
      )}
    </div>
  );
}
