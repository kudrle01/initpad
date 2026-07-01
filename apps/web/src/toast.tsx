import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

type ToastKind = 'error' | 'success';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ error: () => {}, success: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const api: ToastApi = {
    error: (m) => push('error', m),
    success: (m) => push('success', m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-icon">
              <Icon name={t.kind === 'success' ? 'checkCircle' : 'alert'} size={17} />
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
