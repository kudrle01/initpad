import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { InfoTip, type InfoTipItem } from '@/components/molecules/InfoTip';
import { Notice } from '@/components/molecules/Notice';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { EnvName, RuntimeKind, Target, TemplateManifest } from '@/types';
import { t, rich } from '@/i18n';

export const ENV_NAMES: EnvName[] = ['dev', 'test', 'prod'];
export type EnvironmentTargets = Record<EnvName, string>;

function runtimeOf(template: TemplateManifest): RuntimeKind {
  return template.runtime ?? (template.artifact === 'static' ? 'static' : 'node');
}

export function targetSupports(target: Target, template: TemplateManifest): boolean {
  return (
    template.compatibleProviders.includes(target.kind) &&
    target.capabilities.includes(runtimeOf(template))
  );
}

export function targetAcceptsNewAssignments(target: Target): boolean {
  return target.scope === 'builtin' || (target.managementState ?? 'active') === 'active';
}

export function targetIsReady(target: Target): boolean {
  if (target.scope === 'user' && (target.managementState ?? 'active') !== 'active') return false;
  if (target.scope === 'user' && target.kind === 'docker') return target.agentReady === true;
  return target.scope === 'builtin' || Boolean(target.verifiedAt);
}

export function suggestedEnvironmentTargets(
  template: TemplateManifest | null,
  targets: Target[],
  hosted: boolean,
): EnvironmentTargets {
  const empty: EnvironmentTargets = { dev: '', test: '', prod: '' };
  if (!template || hosted) return empty; // SaaS requires an explicit choice per environment.
  const usable = targets.filter(
    (target) =>
      targetAcceptsNewAssignments(target) &&
      targetSupports(target, template) &&
      targetIsReady(target),
  );
  const docker = usable.find((target) => target.scope === 'builtin' && target.kind === 'docker');
  const runtime = runtimeOf(template);
  const naturalKind = runtime === 'static' || runtime === 'php' ? 'sftp' : 'docker';
  const production =
    usable.find((target) => target.scope === 'builtin' && target.kind === naturalKind) ??
    usable.find((target) => target.scope === 'user' && target.kind === naturalKind) ??
    docker ??
    usable[0];
  return {
    dev: docker?.id ?? usable[0]?.id ?? '',
    test: docker?.id ?? usable[0]?.id ?? '',
    prod: production?.id ?? '',
  };
}

export function environmentTargetHelp(hosted: boolean): InfoTipItem[] {
  return hosted
    ? [
        {
          title: t('Selection'),
          description: t(
            'Choose a deployment server for each environment. One server may host several environments.',
          ),
        },
        {
          title: t('Isolation'),
          description: t('InitPad keeps dev, test and prod workloads separate.'),
        },
        {
          title: t('Private servers'),
          description: t('Local or private Docker servers connect outbound through InitPad Agent.'),
        },
      ]
    : [
        {
          title: t('Defaults'),
          description: t(
            'Self-hosted deployment targets are selected automatically when compatible.',
          ),
        },
        {
          title: t('Changes'),
          description: t(
            'Each environment can use a different target, now or from the project detail later.',
          ),
        },
      ];
}

function targetOptionNote(target: Target): string {
  if (targetIsReady(target)) return '';
  if (target.scope === 'user' && target.managementState === 'retired') return ` · ${t('retired')}`;
  if (target.scope === 'user' && target.managementState === 'disconnected')
    return ` · ${t('reconnect first')}`;
  if (target.scope === 'user' && target.kind === 'docker')
    return ` · ${target.agentVersion ? t('update or enable Agent') : t('enroll Agent')}`;
  return ` · ${t('verify first')}`;
}

interface Props {
  template: TemplateManifest | null;
  targets: Target[];
  values: EnvironmentTargets;
  hosted: boolean;
  onChange: (environment: EnvName, targetId: string) => void;
  environments?: readonly EnvName[];
  /** The surrounding section already carries the visible heading and help. */
  hideLabel?: boolean;
}

export function EnvironmentTargetFields({
  template,
  targets,
  values,
  hosted,
  onChange,
  environments = ENV_NAMES,
  hideLabel = false,
}: Props) {
  const options = template
    ? targets.filter(
        (target) => targetAcceptsNewAssignments(target) && targetSupports(target, template),
      )
    : [];
  const verifiedOptions = options.filter(targetIsReady);
  const hasUnverified = options.some((target) => !targetIsReady(target));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!hideLabel && (
        <div className="-mb-1 flex items-center gap-1">
          <Label>{t('Environments & targets')}</Label>
          <InfoTip label={t('About environment targets')} items={environmentTargetHelp(hosted)} />
        </div>
      )}
      {/* auto-fit: one field per stage side by side, stacked in a narrow column. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
        {environments.map((environment) => (
          <div key={environment} className="flex min-w-0 flex-col gap-1.5">
            <Label
              htmlFor={`target-${environment}`}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {environment}
            </Label>
            <Select
              id={`target-${environment}`}
              value={values[environment]}
              aria-label={t('{environment} target', { environment: environment })}
              onChange={(event) => onChange(environment, event.target.value)}
            >
              <option value="">{t('Choose target…')}</option>
              {options.map((target) => (
                <option key={target.id} value={target.id} disabled={!targetIsReady(target)}>
                  {target.name} · {target.kind}
                  {targetOptionNote(target)}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      {template && verifiedOptions.length === 0 && (
        <Notice tone="warning" role="alert" icon={ShieldAlert}>
          {rich(
            'No connected and verified target can run <b>{template}</b>. <link>Add or reconnect a server</link> before creating the project.',
            {
              template: runtimeOf(template),
              b: (chunk) => <b className="font-semibold text-foreground">{chunk}</b>,
              link: (chunk) => (
                <Link to="/infrastructure" className="text-link font-medium">
                  {chunk}
                </Link>
              ),
            },
          )}
        </Notice>
      )}
      {hasUnverified && verifiedOptions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rich(
            'Some compatible targets are disabled until their connection or Agent is ready in <link>Servers</link>.',
            {
              link: (chunk) => (
                <Link to="/infrastructure" className="text-link font-medium">
                  {chunk}
                </Link>
              ),
            },
          )}
        </p>
      )}
    </div>
  );
}
