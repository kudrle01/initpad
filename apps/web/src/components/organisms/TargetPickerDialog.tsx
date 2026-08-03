import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Cloud, Container, Network, Server, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/atoms/Spinner';
import { targetIsReady } from '@/components/organisms/EnvironmentTargetFields';
import { cn } from '@/lib/utils';
import type { EnvName, EnvTarget, ProviderKind, RuntimeKind, Target, TemplateManifest } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

function runtimeOf(t: TemplateManifest): RuntimeKind {
  return t.runtime ?? (t.artifact === 'static' ? 'static' : 'node');
}

// A target is usable for a template when the template accepts its kind and the
// target can run the template's runtime.
function usable(target: Target, template: TemplateManifest): boolean {
  return (
    template.compatibleProviders.includes(target.kind) &&
    target.capabilities.includes(runtimeOf(template))
  );
}

interface Props {
  env: EnvName | null;
  current: EnvTarget | null;
  template: TemplateManifest | null;
  targets: Target[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (env: EnvName, targetId: string) => void;
}

// Pick which target an environment deploys to. Only targets that can actually
// run this template are listed; incompatible ones are explained via the footer.
export function TargetPickerDialog({ env, current, template, targets, busy, onOpenChange, onPick }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (env) setSelected(current?.id ?? null);
  }, [env, current]);

  const options = template ? targets.filter((t) => usable(t, template)) : [];
  const verifiedOptions = options.filter(targetIsReady);
  const missingCapability = template
    ? targets.filter(
        (target) =>
          target.scope === 'user' &&
          template.compatibleProviders.includes(target.kind) &&
          !target.capabilities.includes(runtimeOf(template)),
      )
    : [];

  return (
    <Dialog open={!!env} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Network className="h-[18px] w-[18px]" /> Deployment target ({env})
          </DialogTitle>
          <DialogDescription>
            Choose where <b className="font-semibold text-foreground">{env}</b> deploys. Changing it
            on a live environment tears down the old deployment first.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
          {verifiedOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No verified compatible target yet. Add or test a server in{' '}
              <Link to="/infrastructure" className="text-link">
                Infrastructure
              </Link>
              .
            </p>
          )}
          {options.map((t) => {
            const Icon = KIND_ICON[t.kind] ?? Server;
            const active = selected === t.id;
            const isCurrent = current?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => targetIsReady(t) && setSelected(t.id)}
                disabled={!targetIsReady(t)}
                aria-pressed={active}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  !targetIsReady(t) && 'cursor-not-allowed opacity-55',
                  active ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40',
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.scope === 'builtin' ? 'built-in' : 'yours'}
                    </span>
                    {t.verifiedAt && (
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Verified" />
                    )}
                    {isCurrent && <span className="text-[11px] text-muted-foreground">current</span>}
                    {!targetIsReady(t) && <span className="text-[11px] text-warning">verify first</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t.kind}
                    {t.host ? ` · ${t.host}` : ''} · runs {t.capabilities.join(', ')}
                  </div>
                </div>
                {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {missingCapability.length > 0 && template && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-muted-foreground">
              {missingCapability.map((target) => target.name).join(', ')}{' '}
              {missingCapability.length === 1 ? 'is' : 'are'} hidden because the target capability list does not include{' '}
              <b className="font-semibold text-foreground">{runtimeOf(template)}</b>.{' '}
              <Link to="/infrastructure" className="text-link font-medium">Update capabilities</Link>
              .
            </p>
          )}
        </div>

        <DialogFooter className="items-stretch sm:items-center">
          <Link
            to="/infrastructure"
            className="text-link mr-auto self-start py-2 text-xs font-medium sm:py-0"
          >
            Manage targets
          </Link>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !selected || selected === current?.id}
            onClick={() => env && selected && onPick(env, selected)}
          >
            {busy && <Spinner className="h-4 w-4" />}
            Use target
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
