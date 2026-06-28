import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  message: string;
  detail?: string;
  className?: string;
}

/**
 * Inline error card — used for page-level fetch failures.
 * When `detail` is provided, a "Details" button opens a modal overlay.
 */
export function InlineError({ message, detail, className = '' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`card border-red-200 bg-red-50 text-red-700 flex items-center gap-2 ${className}`}>
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="flex-1 text-sm">{message}</span>
        {detail && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-red-600 text-xs underline underline-offset-2 hover:text-red-800 whitespace-nowrap transition-colors shrink-0"
          >
            Details
          </button>
        )}
      </div>

      {open && detail && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg border border-red-100 overflow-hidden">
            <div className="flex items-start gap-3 px-5 py-4 bg-red-50 border-b border-red-100">
              <div className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-red-800">Error</h2>
                <p className="mt-0.5 text-sm text-red-700 break-words">{message}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 text-red-400 hover:text-red-700 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Detail</p>
              <pre className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-64 overflow-y-auto">
                {detail}
              </pre>
            </div>
            <div className="px-5 pb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
