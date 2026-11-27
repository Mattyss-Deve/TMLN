import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types/timeline';

interface ToastNotificationProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastNotification({ toasts, onDismiss }: ToastNotificationProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{ top: 'calc(env(safe-area-inset-top, 28px) + 56px)' }}
      className="fixed left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[min(92vw,400px)] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isError = toast.kind === 'error';
        const isSuccess = toast.kind === 'success';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl instrument-surface-strong transition-all ${
              isError
                ? 'border-rose-500/35'
                : isSuccess
                  ? 'border-emerald-500/30'
                  : 'border-white/[0.10]'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {isError ? (
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              ) : isSuccess ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Info className="w-4 h-4 text-cyan-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-100">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400 break-words">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-[0.98] transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
