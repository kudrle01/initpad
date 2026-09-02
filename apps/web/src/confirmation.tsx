import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ConfirmationDetail {
  label: string;
  value: ReactNode;
}

export interface ConfirmationOptions {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'warning' | 'danger';
  details?: ConfirmationDetail[];
  consequences?: ReactNode[];
  requireText?: string;
}

type RequestConfirmation = (options: ConfirmationOptions) => Promise<boolean>;

const ConfirmationContext = createContext<RequestConfirmation | null>(null);

interface PendingConfirmation {
  options: ConfirmationOptions;
  resolve: (confirmed: boolean) => void;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [typedText, setTypedText] = useState('');

  const finish = useCallback((confirmed: boolean) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    setOptions(null);
    setTypedText('');
    pending.resolve(confirmed);
  }, []);

  const requestConfirmation = useCallback<RequestConfirmation>((nextOptions) => {
    // There should only be one consequential action awaiting a decision. If a
    // second request arrives, fail the previous one closed instead of leaving
    // its Promise or UI action hanging.
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      pendingRef.current = { options: nextOptions, resolve };
      setTypedText('');
      setOptions(nextOptions);
    });
  }, []);

  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const danger = options?.tone === 'danger';
  const confirmedByText = !options?.requireText || typedText === options.requireText;

  return (
    <ConfirmationContext.Provider value={requestConfirmation}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => !open && finish(false)}>
        <DialogContent className="max-w-md">
          {options && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {danger ? (
                    <ShieldAlert className="h-[18px] w-[18px] text-destructive" />
                  ) : (
                    <AlertTriangle className="h-[18px] w-[18px] text-warning" />
                  )}
                  {options.title}
                </DialogTitle>
                <DialogDescription>{options.description}</DialogDescription>
              </DialogHeader>

              {options.details && options.details.length > 0 && (
                <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                  {options.details.map((detail) => (
                    <div key={detail.label} className="contents">
                      <dt className="text-muted-foreground">{detail.label}</dt>
                      <dd className="min-w-0 break-words text-right font-medium">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {options.consequences && options.consequences.length > 0 && (
                <div
                  className={cn(
                    'rounded-lg border p-3 text-sm',
                    danger
                      ? 'border-destructive/40 bg-destructive/5'
                      : 'border-warning/50 bg-warning/10',
                  )}
                >
                  <p className="font-medium">What will happen</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {options.consequences.map((consequence, index) => (
                      <li key={index}>{consequence}</li>
                    ))}
                  </ul>
                </div>
              )}

              {options.requireText && (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor="confirmation-text" className="text-sm">
                    Type <strong className="font-semibold">{options.requireText}</strong> to confirm:
                  </label>
                  <Input
                    id="confirmation-text"
                    value={typedText}
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => setTypedText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && confirmedByText) finish(true);
                    }}
                  />
                </div>
              )}

              <DialogFooter>
                <Button variant="secondary" onClick={() => finish(false)}>Cancel</Button>
                <Button
                  variant={danger ? 'destructive' : 'default'}
                  className={danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
                  disabled={!confirmedByText}
                  onClick={() => finish(true)}
                >
                  {options.confirmLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation(): RequestConfirmation {
  const context = useContext(ConfirmationContext);
  if (!context) throw new Error('useConfirmation must be used inside ConfirmationProvider');
  return context;
}
