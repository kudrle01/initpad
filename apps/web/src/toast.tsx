import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

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

/** How long a success or warning stays visible; errors stay until dismissed. */
export const TOAST_DURATION_MS = 6000;

let nextId = 1;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  // Remaining time survives a pause, so hovering does not restart the clock.
  const remaining = useRef(TOAST_DURATION_MS);
  const persistent = toast.kind === 'error';

  useEffect(() => {
    if (persistent || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [persistent, paused, onDismiss, toast.id]);

  return (
    <div
      role={persistent ? 'alert' : 'status'}
      data-testid="toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex max-w-full items-start gap-2.5 break-words rounded-lg border bg-popover py-3 pl-4 pr-2 text-sm font-medium text-popover-foreground shadow-lg sm:max-w-md',
        'animate-in slide-in-from-top-2 fade-in',
        toast.kind === 'success'
          ? 'border-success/25'
          : toast.kind === 'warning'
            ? 'border-warning/25'
            : 'border-destructive/25',
      )}
    >
      <span
        className={cn(
          'mt-px shrink-0',
          toast.kind === 'success'
            ? 'text-success'
            : toast.kind === 'warning'
              ? 'text-warning'
              : 'text-destructive',
        )}
      >
        {toast.kind === 'success' ? (
          <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('Dismiss notification')}
        className="-my-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((current) => {
      // The same error repeated by polling would otherwise stack up.
      if (current.some((toast) => toast.kind === kind && toast.message === message)) return current;
      return [...current, { id, kind, message }];
    });
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
      {/* Live regions must exist before content is added to them. */}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
