import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { InfoTip } from '@/components/molecules/InfoTip';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { EnvName, RuntimeKind, Target, TemplateManifest } from '@/types';

export const ENV_NAMES: EnvName[] = ['dev', 'test', 'prod'];
export type EnvironmentTargets = Record<EnvName, string>;

function runtimeOf(template: TemplateManifest): RuntimeKind {
  return template.runtime ?? (template.artifact === 'static' ? 'static' : 'node');
}

export function targetSupports(target: Target, template: TemplateManifest): boolean {
  return template.compatibleProviders.includes(target.kind) &&
    target.capabilities.includes(runtimeOf(template));
}

export function targetAcceptsNewAssignments(target: Target): boolean {
  return target.kind !== 'ssh';
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
  const usable = targets.filter((target) =>
    targetAcceptsNewAssignments(target) && targetSupports(target, template) && targetIsReady(target));
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

interface Props {
  template: TemplateManifest | null;
  targets: Target[];
  values: EnvironmentTargets;
  hosted: boolean;
  onChange: (environment: EnvName, targetId: string) => void;
}

export function EnvironmentTargetFields({ template, targets, values, hosted, onChange }: Props) {
  const options = template
    ? targets.filter((target) =>
        targetAcceptsNewAssignments(target) && targetSupports(target, template))
    : [];
  const verifiedOptions = options.filter(targetIsReady);
  const hasUnverified = options.some((target) => !targetIsReady(target));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Label>Environments &amp; targets</Label>
        <InfoTip
          label="About environment targets"
          items={hosted ? [
            {
              title: 'Selection',
              description: 'Choose a deployment server for each environment. One server may host several environments.',
            },
            {
              title: 'Isolation',
              description: 'InitPad keeps dev, test and prod workloads separate.',
            },
            {
              title: 'Private servers',
              description: 'Local or private Docker servers connect outbound through InitPad Agent.',
            },
          ] : [
            {
              title: 'Defaults',
              description: 'Self-hosted deployment targets are selected automatically when compatible.',
            },
            {
              title: 'Changes',
              description: 'Each environment can use a different target, now or from the project detail later.',
            },
          ]}
        />
      </div>
      <div className="grid max-w-3xl gap-2 md:grid-cols-3">
        {ENV_NAMES.map((environment) => (
          <div key={environment} className="rounded-lg border border-border bg-card p-3">
            <Label htmlFor={`target-${environment}`} className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
              {environment}
            </Label>
            <Select
              id={`target-${environment}`}
              value={values[environment]}
              aria-label={`${environment} target`}
              onChange={(event) => onChange(environment, event.target.value)}
            >
              <option value="">Choose target…</option>
              {options.map((target) => (
                <option key={target.id} value={target.id} disabled={!targetIsReady(target)}>
                  {target.name} · {target.kind}
                  {!targetIsReady(target)
                    ? target.scope === 'user' && target.managementState === 'retired'
                      ? ' · retired'
                      : target.scope === 'user' && target.managementState === 'disconnected'
                        ? ' · reconnect first'
                        : target.scope === 'user' && target.kind === 'docker'
                      ? ` · ${target.agentVersion ? 'update or enable Agent' : 'enroll Agent'}`
                      : ' · verify first'
                    : ''}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      {template && verifiedOptions.length === 0 && (
        <p role="alert" className="flex max-w-3xl items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            No connected and verified target can run <b className="font-semibold text-foreground">{runtimeOf(template)}</b>.{' '}
            <Link to="/infrastructure" className="text-link font-medium">Add or reconnect a server</Link>
            {' '}before creating the project.
          </span>
        </p>
      )}
      {hasUnverified && verifiedOptions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Some compatible targets are disabled until their connection or Agent is ready in{' '}
          <Link to="/infrastructure" className="text-link font-medium">Servers</Link>.
        </p>
      )}
    </div>
  );
}
