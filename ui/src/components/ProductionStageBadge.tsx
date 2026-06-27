import type { ProductionStage } from '@api';
import { PRODUCTION_STAGE_LABELS } from '@api';

const STAGE_CLASS: Record<ProductionStage, string> = {
  catalog:       'bg-slate-100 text-slate-600',
  assigned:      'bg-indigo-100 text-indigo-700',
  sample_review: 'bg-amber-100 text-amber-700',
  narrating:     'bg-violet-100 text-violet-700',
  delivered:     'bg-cyan-100 text-cyan-700',
  processing:    'bg-blue-100 text-blue-700',
  processed:     'bg-sky-100 text-sky-700',
  dossier_ready: 'bg-teal-100 text-teal-700',
  synced:        'bg-emerald-100 text-emerald-700',
  failed:        'bg-red-100 text-red-700',
};

export function ProductionStageBadge({ stage, isArabic = false, className = '' }: { stage: ProductionStage; isArabic?: boolean; className?: string }) {
  const label = PRODUCTION_STAGE_LABELS[stage] ?? { en: stage, ar: stage };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_CLASS[stage] ?? 'bg-slate-100 text-slate-600'} ${className}`}>
      {isArabic ? label.ar : label.en}
    </span>
  );
}
