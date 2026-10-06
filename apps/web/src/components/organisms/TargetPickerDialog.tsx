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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/atoms/Spinner';
import {
  targetAcceptsNewAssignments,
  targetIsReady,
} from '@/components/organisms/EnvironmentTargetFields';
import { cn } from '@/lib/utils';
import type {
  EnvName,
  EnvTarget,
  ProviderKind,
  RuntimeKind,
  Target,
  TemplateManifest,
} from '@/types';
import { t, rich, richPlural } from '@/i18n';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  sftp: Cloud,
};

function runtimeOf(template: TemplateManifest): RuntimeKind {
  return template.runtime ?? (template.artifact === 'static' ? 'static' : 'node');
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
export function TargetPickerDialog({
  env,
  current,
  template,
  targets,
  busy,
  onOpenChange,
  onPick,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (env) setSelected(current?.id ?? null);
  }, [env, current]);

  const options = template
    ? targets.filter(
        (target) =>
          usable(target, template) &&
          (targetAcceptsNewAssignments(target) || target.id === current?.id),
      )
    : [];
  const selectableOptions = options.filter(
    (target) => targetAcceptsNewAssignments(target) && targetIsReady(target),
  );
  const selectedTarget = options.find((target) => target.id === selected) ?? null;
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
            <Network className="h-[18px] w-[18px]" />{' '}
            {t('Deployment target ({env})', { env: env ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {rich(
              'Choose where <b>{env}</b> deploys. Changing it on a live environment tears down the old deployment first.',
              { env: env, b: (chunk) => <b className="font-semibold text-foreground">{chunk}</b> },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex max-h-[52vh] flex-col gap-2 overflow-y-auto px-1 py-0.5">
          {selectableOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {rich(
                'No supported and verified replacement target yet. Add or test a server in <link>Servers</link>.',
                {
                  link: (chunk) => (
                    <Link to="/infrastructure" className="text-link">
                      {chunk}
                    </Link>
                  ),
                },
              )}
            </p>
          )}
          {options.map((option) => {
            const Icon = KIND_ICON[option.kind] ?? Server;
            const active = selected === option.id;
            const isCurrent = current?.id === option.id;
            const selectable = targetAcceptsNewAssignments(option) && targetIsReady(option);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => selectable && setSelected(option.id)}
                disabled={!selectable}
                aria-pressed={active}
                className={cn(
                  'flex min-w-0 items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  !selectable && 'cursor-not-allowed opacity-55',
                  active
                    ? 'border-primary/60 bg-secondary/60'
                    : 'border-border bg-card hover:border-input hover:bg-muted/50',
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 break-words text-sm font-medium">{option.name}</span>
                    <Badge className="px-2 py-0">
                      {option.scope === 'builtin' ? t('built-in') : t('yours')}
                    </Badge>
                    {option.verifiedAt && (
                      <ShieldCheck
                        className="h-3.5 w-3.5 shrink-0 text-success"
                        aria-label={t('Verified')}
                      />
                    )}
                    {isCurrent && (
                      <span className="text-xs text-muted-foreground">{t('current')}</span>
                    )}
                    {!targetIsReady(option) && (
                      <span className="text-xs text-warning">
                        {option.scope === 'user' && option.managementState === 'retired'
                          ? t('retired')
                          : option.scope === 'user' && option.managementState === 'disconnected'
                            ? t('reconnect first')
                            : option.kind === 'docker' && option.scope === 'user'
                              ? t('Agent not ready')
                              : t('verify first')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {option.kind}
                    {option.host ? ` · ${option.host}` : ''} ·{' '}
                    {t('runs {runtimes}', { runtimes: option.capabilities.join(', ') })}
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-card',
                  )}
                >
                  {active && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
          {missingCapability.length > 0 && template && (
            <p className="tint-warning rounded-lg border border-warning/30 p-3 text-xs text-muted-foreground">
              {richPlural(
                '{names} are hidden because the target capability list does not include <b>{runtime}</b>. <link>Update capabilities</link>.',
                missingCapability.length,
                {
                  names: missingCapability.map((target) => target.name).join(', '),
                  runtime: runtimeOf(template),
                  b: (chunk) => <b className="font-semibold text-foreground">{chunk}</b>,
                  link: (chunk) => (
                    <Link to="/infrastructure" className="text-link font-medium">
                      {chunk}
                    </Link>
                  ),
                },
              )}
            </p>
          )}
          {selectedTarget && selectedTarget.id !== current?.id && (
            <div className="tint-warning rounded-lg border border-warning/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{t('Confirm target change')}</p>
              <p className="mt-1">
                {current
                  ? t(
                      '{name} will be replaced by {name2}. A live deployment is removed from the old target and must be deployed to the new one.',
                      { name: current.name, name2: selectedTarget.name },
                    )
                  : t('{name} will become the deployment target for this environment.', {
                      name: selectedTarget.name,
                    })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="items-stretch sm:items-center">
          <Link
            to="/infrastructure"
            className="text-link mr-auto self-start py-2 text-sm font-medium sm:self-center sm:py-0"
          >
            {t('Manage servers')}
          </Link>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={busy || !selected || selected === current?.id}
            onClick={() => env && selected && onPick(env, selected)}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {current ? t('Change target') : t('Use target')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
