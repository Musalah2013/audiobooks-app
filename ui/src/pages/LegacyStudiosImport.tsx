import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, CheckCircle2, AlertCircle, FileSpreadsheet, Building2, Users, Clock, Download } from 'lucide-react';
import { apiRequest, useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast.tsx';
import { useLocale } from '../hooks/useLocale';
import type { StudiosResponse } from '@api';

interface ImportStudio {
  studioId?: string;
  name: string;
  slug?: string;
  contactEmail?: string;
  emails?: string[];
  hourlyRateUsd?: number | null;
  active?: boolean;
  productions: { bookTitle: string; isbn?: string; narrator?: string; netHours?: number; notes?: string }[];
}

interface Production { bookTitle: string; isbn?: string; narrator?: string; netHours?: number; notes?: string }

const COLUMN_MAP: Record<string, string> = {
  'studio': 'name', 'studio name': 'name', name: 'name', الاستوديو: 'name', 'اسم الاستوديو': 'name',
  slug: 'slug', الرابط: 'slug',
  'contact email': 'contactEmail', contactemail: 'contactEmail', email: 'contactEmail', البريد: 'contactEmail',
  emails: 'emails', 'extra emails': 'emails', users: 'emails', المستخدمون: 'emails',
  'hourly rate': 'hourlyRate', hourlyrate: 'hourlyRate', rate: 'hourlyRate', السعر: 'hourlyRate',
  active: 'active', نشط: 'active',
  'book title': 'bookTitle', booktitle: 'bookTitle', book: 'bookTitle', title: 'bookTitle', العنوان: 'bookTitle', 'اسم الكتاب': 'bookTitle',
  isbn: 'isbn', ردمك: 'isbn',
  narrator: 'narrator', الراوي: 'narrator', القارئ: 'narrator',
  'net hours': 'netHours', nethours: 'netHours', hours: 'netHours', 'الساعات': 'netHours', 'الساعات الصافية': 'netHours',
  notes: 'notes', ملاحظات: 'notes',
};

function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let inQuotes = false;
  const delim = text.includes('\t') && !text.includes(',') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += ch; }
    else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseStudios(text: string): { studios: ImportStudio[]; unmapped: string[] } {
  const grid = parseDelimited(text);
  if (grid.length < 2) return { studios: [], unmapped: [] };
  // Normalize underscores to spaces so header forms like `contact_email`,
  // `book_title`, `net_hours` (used by the downloadable template) match the map.
  const headers = grid[0].map((h) => h.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' '));
  const mapped = headers.map((h) => COLUMN_MAP[h]);
  const unmapped = headers.filter((h, i) => h && !mapped[i]);
  const byKey = new Map<string, ImportStudio>();
  for (const r of grid.slice(1)) {
    const v: Record<string, string> = {};
    mapped.forEach((f, i) => { if (f) { const raw = (r[i] ?? '').trim(); if (raw) v[f] = raw; } });
    if (!v.name) continue;
    const key = (v.slug || v.name).toLowerCase();
    let studio = byKey.get(key);
    if (!studio) {
      studio = {
        name: v.name,
        slug: v.slug,
        contactEmail: v.contactEmail ?? '',
        emails: v.emails ? v.emails.split(/[;,]/).map((e) => e.trim()).filter(Boolean) : undefined,
        hourlyRateUsd: v.hourlyRate ? Number(v.hourlyRate.replace(/[^0-9.]/g, '')) : undefined,
        active: v.active ? /^(1|true|yes|y|نعم)$/i.test(v.active) : undefined,
        productions: [],
      };
      byKey.set(key, studio);
    }
    if (v.bookTitle) {
      studio.productions.push({
        bookTitle: v.bookTitle,
        isbn: v.isbn,
        narrator: v.narrator,
        netHours: v.netHours ? Number(v.netHours.replace(/[^0-9.]/g, '')) : undefined,
        notes: v.notes,
      });
    }
  }
  return { studios: [...byKey.values()], unmapped };
}

function parseProductions(text: string): { productions: Production[]; unmapped: string[] } {
  const grid = parseDelimited(text);
  if (grid.length < 2) return { productions: [], unmapped: [] };
  // Normalize underscores to spaces so header forms like `contact_email`,
  // `book_title`, `net_hours` (used by the downloadable template) match the map.
  const headers = grid[0].map((h) => h.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' '));
  const mapped = headers.map((h) => COLUMN_MAP[h]);
  const prodFields = new Set(['bookTitle', 'isbn', 'narrator', 'netHours', 'notes']);
  const unmapped = headers.filter((h, i) => h && (!mapped[i] || !prodFields.has(mapped[i])));
  const productions: Production[] = [];
  for (const r of grid.slice(1)) {
    const v: Record<string, string> = {};
    mapped.forEach((f, i) => { if (f && prodFields.has(f)) { const raw = (r[i] ?? '').trim(); if (raw) v[f] = raw; } });
    if (!v.bookTitle) continue;
    productions.push({
      bookTitle: v.bookTitle,
      isbn: v.isbn,
      narrator: v.narrator,
      netHours: v.netHours ? Number(v.netHours.replace(/[^0-9.]/g, '')) : undefined,
      notes: v.notes,
    });
  }
  return { productions, unmapped };
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const STUDIOS_TEMPLATE = [
  'studio,slug,contact_email,emails,hourly_rate,active,book_title,isbn,narrator,net_hours,notes',
  'O2 Studio,o2-studio,studio@example.com,second@example.com;third@example.com,25,true,The Example Book,9781234567890,Narrator Name,6.5,Delivered 2023',
].join('\n');

const PRODUCTIONS_TEMPLATE = [
  'book_title,isbn,narrator,net_hours,notes',
  'The Example Book,9781234567890,Narrator Name,6.5,Delivered 2023',
].join('\n');

export default function LegacyStudiosImport() {
  const { addToast } = useToast();
  const { isArabic } = useLocale();
  const { data: studiosData } = useApi<StudiosResponse>('/api/studios');
  const existingStudios = studiosData?.studios ?? [];
  const [selectedStudioId, setSelectedStudioId] = useState('');
  const [raw, setRaw] = useState('');
  const [studios, setStudios] = useState<ImportStudio[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ studiosCreated: number; studiosUpdated: number; productionsCreated: number } | null>(null);

  const invalid = studios.filter((s) => !s.studioId && !s.contactEmail);
  const totalProductions = studios.reduce((n, s) => n + s.productions.length, 0);

  function reparse(text: string, studioId = selectedStudioId) {
    setRaw(text);
    if (studioId) {
      const studio = existingStudios.find((s) => s.id === studioId);
      const { productions, unmapped } = parseProductions(text);
      setStudios(productions.length > 0 && studio ? [{ studioId, name: studio.name, productions }] : []);
      setUnmapped(unmapped);
    } else {
      const { studios, unmapped } = parseStudios(text);
      setStudios(studios);
      setUnmapped(unmapped);
    }
  }

  function onStudioChange(studioId: string) {
    setSelectedStudioId(studioId);
    reparse(raw, studioId);
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => reparse(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function commit() {
    if (studios.length === 0 || invalid.length > 0) return;
    setImporting(true);
    try {
      const res = await apiRequest<{ studiosCreated: number; studiosUpdated: number; productionsCreated: number }>('/api/studios/legacy-import', {
        method: 'POST',
        body: { studios },
      });
      setDone(res);
      addToast(isArabic ? `تم استيراد ${res.studiosCreated + res.studiosUpdated} استوديو.` : `Imported ${res.studiosCreated + res.studiosUpdated} studios.`, 'success');
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
          <p className="section-subtitle">
            {isArabic
              ? `${done.studiosCreated} استوديو جديد، ${done.studiosUpdated} محدّث، ${done.productionsCreated} إنتاج قديم.`
              : `${done.studiosCreated} created, ${done.studiosUpdated} updated, ${done.productionsCreated} legacy productions.`}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link to="/studios" className="btn-primary">{isArabic ? 'لوحة الاستوديوهات' : 'Studios dashboard'}</Link>
            <button type="button" className="btn-secondary" onClick={() => { setDone(null); setRaw(''); setStudios([]); }}>{isArabic ? 'استيراد آخر' : 'Import more'}</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-stone-200 p-3 text-stone-600"><Building2 className="h-5 w-5" /></div>
          <div>
            <h2 className="section-title">{isArabic ? 'استيراد الاستوديوهات القديمة' : 'Legacy studios import'}</h2>
            <p className="section-subtitle">{isArabic ? 'استيراد لمرة واحدة للاستوديوهات ومستخدميها وأسعارها وإنتاجها التاريخي (ساعات صافية → تكلفة).' : 'One-time import of studios with their users, rates, and historical productions (net hours → billing).'}</p>
          </div>
        </div>
      </section>

      <section className="card space-y-3">
        <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'البيانات' : 'Data'}</h3>

        {/* Attach to an existing studio (optional) */}
        <div>
          <label className="text-xs font-semibold text-[color:var(--fg-2)] mb-1 block">{isArabic ? 'إرفاق بإستوديو موجود (اختياري)' : 'Attach to an existing studio (optional)'}</label>
          <select className="input w-full max-w-md" value={selectedStudioId} onChange={(e) => onStudioChange(e.target.value)}>
            <option value="">{isArabic ? '— استوديوهات جديدة من الملف —' : '— New studios defined in the file —'}</option>
            {existingStudios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-[color:var(--fg-2)]">
          {selectedStudioId
            ? (isArabic ? 'كل صف = كتاب قديم يُضاف للإستوديو المحدد. الأعمدة: ' : 'Each row = one legacy book for the selected studio. Columns: ')
            : (isArabic ? 'صف لكل سطر. صفوف نفس الاستوديو تتجمّع. الأعمدة: ' : 'One row per line; rows for the same studio are grouped. Columns: ')}
          <code className="font-mono text-[11px]">{selectedStudioId ? 'book_title, isbn, narrator, net_hours, notes' : 'studio, slug, contact_email, emails (;-sep), hourly_rate, active, book_title, isbn, narrator, net_hours, notes'}</code>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn-secondary text-xs" onClick={() => selectedStudioId
            ? downloadCsv('legacy-productions-template.csv', PRODUCTIONS_TEMPLATE)
            : downloadCsv('legacy-studios-template.csv', STUDIOS_TEMPLATE)}>
            <Download className="h-3.5 w-3.5" />{isArabic ? 'تنزيل القالب' : 'Download template'}
          </button>
          <label className="btn-secondary text-xs cursor-pointer">
            <FileSpreadsheet className="h-3.5 w-3.5" />{isArabic ? 'رفع CSV' : 'Upload CSV'}
            <input type="file" accept=".csv,.tsv,text/csv,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </label>
          {studios.length > 0 && <span className="text-xs text-emerald-700 font-semibold">{studios.length} {isArabic ? 'استوديو' : 'studios'} · {totalProductions} {isArabic ? 'إنتاج' : 'productions'}</span>}
        </div>
        <textarea
          className="input w-full font-mono text-xs min-h-[160px]"
          value={raw}
          onChange={(e) => reparse(e.target.value)}
          placeholder={selectedStudioId
            ? 'book_title,narrator,net_hours,isbn\nThe Example,Narrator,6.5,9781234567890'
            : 'studio,contact_email,hourly_rate,book_title,narrator,net_hours\nO2 Studio,studio@example.com,25,The Example,Narrator,6.5'}
        />
        {unmapped.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {isArabic ? 'أعمدة غير معروفة: ' : 'Unrecognized columns: '}<strong>{unmapped.join(', ')}</strong>
          </div>
        )}
        {invalid.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {isArabic ? `${invalid.length} استوديو بدون بريد إلكتروني. أضِف عمود contact_email.` : `${invalid.length} studio(s) missing a contact_email.`}
          </div>
        )}
      </section>

      {studios.length > 0 && (
        <section className="card space-y-3">
          <h3 className="text-base font-bold text-[color:var(--samawy-ink)]">{isArabic ? 'معاينة' : 'Preview'} <span className="text-xs font-normal text-[color:var(--fg-2)]">({studios.length})</span></h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {studios.slice(0, 40).map((s, i) => {
              const netHours = s.productions.reduce((n, p) => n + (p.netHours ?? 0), 0);
              const cost = s.hourlyRateUsd != null ? s.hourlyRateUsd * netHours : null;
              return (
                <div key={i} className={`rounded-xl border px-3 py-2.5 ${(s.studioId || s.contactEmail) ? 'border-slate-100' : 'border-red-200 bg-red-50'}`}>
                  <p className="text-sm font-bold text-[color:var(--samawy-ink)]">{s.name}</p>
                  <p className="text-xs text-[color:var(--fg-2)] truncate">{s.studioId ? (isArabic ? 'استوديو موجود' : 'existing studio') : (s.contactEmail || (isArabic ? '⚠ بدون بريد' : '⚠ no email'))}{s.emails?.length ? ` +${s.emails.length}` : ''}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-[color:var(--fg-2)]">
                    {!s.studioId && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{1 + (s.emails?.length ?? 0)}</span>}
                    <span className="flex items-center gap-1"><FileSpreadsheet className="h-3 w-3" />{s.productions.length}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{netHours.toFixed(1)}h</span>
                    {s.hourlyRateUsd != null && <span className="text-emerald-700 font-semibold">${s.hourlyRateUsd}/h{cost != null ? ` → $${cost.toFixed(2)}` : ''}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {studios.length > 40 && <p className="text-xs text-[color:var(--fg-2)]">{isArabic ? `+ ${studios.length - 40} أخرى` : `+ ${studios.length - 40} more`}</p>}
          <div className="flex items-center justify-end pt-1">
            <button type="button" className="btn-primary" disabled={importing || invalid.length > 0} onClick={commit}>
              <Upload className="h-4 w-4" />
              {importing ? (isArabic ? 'جاري الاستيراد…' : 'Importing…') : (isArabic ? `استيراد ${studios.length} استوديو` : `Import ${studios.length} studios`)}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
