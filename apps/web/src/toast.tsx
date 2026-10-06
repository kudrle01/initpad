import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'error' | 'success' | 'warning';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({
  error: () => {},
  success: () => {},
  warning: () => {},
});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      error: (message) => push('error', message),
      success: (message) => push('success', message),
      warning: (message) => push('warning', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex max-w-full items-start gap-2.5 break-words rounded-lg border bg-popover px-4 py-3 text-sm font-medium text-popover-foreground shadow-lg sm:max-w-md',
              'animate-in slide-in-from-top-2 fade-in',
              t.kind === 'success'
                ? 'border-success/25'
                : t.kind === 'warning'
                  ? 'border-warning/25'
                  : 'border-destructive/25',
            )}
          >
            <span
              className={cn(
                'mt-px shrink-0',
                t.kind === 'success'
                  ? 'text-success'
                  : t.kind === 'warning'
                    ? 'text-warning'
                    : 'text-destructive',
              )}
            >
              {t.kind === 'success' ? (
                <CheckCircle2 className="h-[18px] w-[18px]" />
              ) : (
                <AlertTriangle className="h-[18px] w-[18px]" />
              )}
            </span>
            <span className="min-w-0">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
