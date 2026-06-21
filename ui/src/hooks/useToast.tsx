import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { ApiError } from './useApi';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  detail?: string;
}

interface ToastContextType {
  toasts: Toast[];
  /** Pass a plain string, or an Error/ApiError — detail is extracted automatically from ApiError. */
  addToast: (message: string | Error, type?: ToastType, detail?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// ── Error detail modal ────────────────────────────────────────────────────────

interface ErrorDetailModalProps {
  message: string;
  detail: string;
  onClose: () => void;
}

function ErrorDetailModal({ message, detail, onClose }: ErrorDetailModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="err-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg border border-red-100 overflow-hidden">

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 bg-red-50 border-b border-red-100">
          <div className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="err-modal-title" className="text-sm font-700 text-red-800 font-semibold leading-snug">
              Error
            </h2>
            <p className="mt-0.5 text-sm text-red-700 break-words">{message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-red-400 hover:text-red-700 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
            </svg>
          </button>
        </div>

        {/* Detail body */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Detail</p>
          <pre className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-64 overflow-y-auto">
            {detail}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 active:bg-red-800 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast item ────────────────────────────────────────────────────────────────

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [showDetail, setShowDetail] = useState(false);

  const colorClass =
    toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800'
    : toast.type === 'error'  ? 'bg-red-50 border-red-200 text-red-800'
    : toast.type === 'warning'? 'bg-yellow-50 border-yellow-200 text-yellow-800'
    :                           'bg-blue-50 border-blue-200 text-blue-800';

  return (
    <>
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium
          animate-in slide-in-from-right fade-in duration-200 max-w-sm ${colorClass}`}
      >
        <span className="flex-1 leading-snug break-words">{toast.message}</span>

        <div className="flex items-center gap-1 shrink-0">
          {toast.detail && (
            <button
              type="button"
              onClick={() => setShowDetail(true)}
              className="text-current opacity-70 hover:opacity-100 text-xs underline underline-offset-2 whitespace-nowrap transition-opacity"
              title="Show error detail"
            >
              Details
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(toast.id)}
            className="text-current opacity-60 hover:opacity-100 leading-none transition-opacity"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>

      {showDetail && toast.detail && (
        <ErrorDetailModal
          message={toast.message}
          detail={toast.detail}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string | Error, type: ToastType = 'info', detail?: string) => {
      let resolvedMessage: string;
      let resolvedDetail: string | undefined = detail;

      if (message instanceof ApiError) {
        resolvedMessage = message.message;
        resolvedDetail = detail ?? message.detail;
      } else if (message instanceof Error) {
        resolvedMessage = message.message;
      } else {
        resolvedMessage = message;
      }

      const id = crypto.randomUUID();
      const hasDetail = Boolean(resolvedDetail);

      setToasts((prev) => [...prev, { id, message: resolvedMessage, type, detail: resolvedDetail }]);

      // Error toasts with detail stay until dismissed; others auto-close after 4 s
      if (!(type === 'error' && hasDetail)) {
        const timer = setTimeout(() => {
          removeToast(id);
        }, 4000);
        timersRef.current.set(id, timer);
      }
    },
    [removeToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
