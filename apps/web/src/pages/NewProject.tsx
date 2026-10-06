import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Check, Rocket, DownloadCloud, Github, Settings2 } from 'lucide-react';
import { api, type EnvConfig, type GitHubStatus } from '@/api';
import { useToast } from '@/toast';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { InfoTip } from '@/components/molecules/InfoTip';
import { FormField } from '@/components/molecules/FormField';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { Section } from '@/components/molecules/Section';
import { StepBadge } from '@/components/molecules/StepBadge';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { Spinner } from '@/components/atoms/Spinner';
import { PipelinePresetField } from '@/components/organisms/PipelinePresetField';
import { cn } from '@/lib/utils';
import { DEFAULT_PIPELINE_PRESET, pipelineStages } from '@/lib/pipeline-presets';
import {
  EnvironmentTargetFields,
  environmentTargetHelp,
  suggestedEnvironmentTargets,
  type EnvironmentTargets,
} from '@/components/organisms/EnvironmentTargetFields';
import type { EnvName, PipelinePreset, RuntimeKind, Target, TemplateManifest } from '@/types';

function runtimeOf(t: TemplateManifest): RuntimeKind {
  return t.runtime ?? (t.artifact === 'static' ? 'static' : 'node');
}

export default function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspace, user } = useAuth();
  const readOnly = activeWorkspace?.role === 'viewer';
  const [params] = useSearchParams();
  const requestedTemplate = params.get('template');
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [name, setName] = useState('my-project');
  const [templateId, setTemplateId] = useState<string>('');
  const [pipelinePreset, setPipelinePreset] = useState<PipelinePreset>(DEFAULT_PIPELINE_PRESET);
  const [environmentTargets, setEnvironmentTargets] = useState<EnvironmentTargets>({
    dev: '',
    test: '',
    prod: '',
  });
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [scmInstallationId, setScmInstallationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const validName = /^[a-z][a-z0-9-]{1,40}$/.test(name);
  const hosted = user?.edition === 'saas';
  const selectedStages = pipelineStages(pipelinePreset);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  const capabilityMismatches = useMemo(() => {
    if (!template) return [];
    const runtime = runtimeOf(template);
    return targets.filter(
      (target) =>
        target.scope === 'user' &&
        template.compatibleProviders.includes(target.kind) &&
        !target.capabilities.includes(runtime),
    );
  }, [targets, template]);

  const selectedInstallation = useMemo(
    () =>
      ghStatus?.installations.find((installation) => installation.id === scmInstallationId) ?? null,
    [ghStatus, scmInstallationId],
  );
  const githubReady =
    !hosted ||
    Boolean(
      ghStatus?.linked &&
      selectedInstallation &&
      ghStatus?.ciCallbackReady &&
      !selectedInstallation.suspended &&
      selectedInstallation.canCreate &&
      (selectedInstallation.accountType === 'Organization' || ghStatus.credentialReady),
    );

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);
    setTemplates([]);
    setTargets([]);
    setTemplateId('');
    setGhStatus(null);
    setScmInstallationId('');
    Promise.all([
      api.listTemplates(),
      api.listTargets(),
      hosted ? api.githubStatus() : Promise.resolve(null),
    ])
      .then(([t, tg, github]) => {
        if (!current) return;
        setTemplates(t);
        setTargets(tg);
        setGhStatus(github);
        const firstInstallation = github?.installations.find(
          (installation) => !installation.suspended && installation.canCreate,
        );
        setScmInstallationId(firstInstallation?.id ?? '');
        // "Use template" on the Templates page preselects a template via ?template=id.
        const preselected = requestedTemplate && t.find((x) => x.id === requestedTemplate);
        if (preselected) setTemplateId(preselected.id);
        else if (t[0]) setTemplateId(t[0].id);
      })
      .catch((error) => {
        if (current) setLoadError((error as Error).message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [hosted, activeWorkspace?.id, reloadKey, requestedTemplate]);

  // Self-hosted gets sensible defaults; SaaS deliberately requires the user
  // to choose each real workspace target because no control-plane-local Docker
  // host exists from a public service.
  useEffect(() => {
    setEnvironmentTargets(suggestedEnvironmentTargets(template ?? null, targets, hosted));
  }, [template, targets, hosted]);

  function chooseTarget(environment: EnvName, targetId: string) {
    setEnvironmentTargets((current) => ({ ...current, [environment]: targetId }));
  }

  async function submit() {
    if (
      readOnly ||
      !validName ||
      !templateId ||
      !githubReady ||
      selectedStages.some((stage) => !environmentTargets[stage])
    )
      return;
    setBusy(true);
    try {
      const environments: EnvConfig[] = selectedStages.map((environment) => ({
        name: environment,
        targetId: environmentTargets[environment],
      }));
      const project = await api.createProject(
        name,
        templateId,
        environments,
        pipelinePreset,
        hosted ? scmInstallationId : undefined,
      );
      toast.success('Project created');
      void navigate(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const targetName = (environment: EnvName) =>
    targets.find((target) => target.id === environmentTargets[environment])?.name;
  const canSubmit =
    !readOnly &&
    !busy &&
    !!templateId &&
    validName &&
    githubReady &&
    !loadError &&
    selectedStages.every((environment) => environmentTargets[environment]);

  return (
    <div>
      <PageHeader
        title="New project"
        description="Pick a template — InitPad creates the repository, the CI/CD pipeline and the environments."
        actions={
          <Button asChild variant="secondary">
            <Link to="/import">
              <DownloadCloud className="h-4 w-4" /> Import existing repository
            </Link>
          </Button>
        }
      />

      {readOnly && (
        <Notice tone="warning" role="alert" className="mb-4">
          Viewer access is read-only. Ask a workspace admin for a member or maintainer role to
          create projects.
        </Notice>
      )}

      {loadError ? (
        <LoadErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
      ) : loading ? (
        <ContentLoading label="Loading project setup" variant="detail" />
      ) : (
        <div className="grid items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            <Section
              title="Name"
              description="Also used for the repository and the application address."
              media={<StepBadge step={1} />}
            >
              <div className="flex max-w-md flex-col gap-4">
                <FormField
                  label="Project name"
                  id="project-name"
                  value={name}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setName(e.target.value)}
                  hint="2–41 lowercase letters, digits or hyphens; starts with a letter."
                  error={
                    name && !validName
                      ? 'Use 2–41 lowercase letters, digits or hyphens; start with a letter.'
                      : null
                  }
                  aria-invalid={name && !validName ? true : undefined}
                />

                {hosted && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <Label htmlFor="repository-owner">GitHub repository owner</Label>
                      <InfoTip
                        label="About the repository owner"
                        items={[
                          {
                            title: 'Repository',
                            description:
                              'InitPad creates a private repository in the selected account.',
                          },
                          {
                            title: 'Available owners',
                            description: `Only GitHub App installations authorized for ${activeWorkspace?.name ?? 'this workspace'} appear here.`,
                          },
                        ]}
                      />
                    </div>
                    {ghStatus?.linked && ghStatus.installations.length > 0 ? (
                      <Select
                        id="repository-owner"
                        value={scmInstallationId}
                        aria-label="GitHub repository owner"
                        onChange={(event) => setScmInstallationId(event.target.value)}
                      >
                        <option value="" disabled>
                          Choose an account or organization…
                        </option>
                        {ghStatus.installations.map((installation) => (
                          <option
                            key={installation.id}
                            value={installation.id}
                            disabled={installation.suspended || !installation.canCreate}
                          >
                            {installation.accountLogin} · {installation.accountType.toLowerCase()}
                            {installation.suspended ? ' · suspended' : ''}
                            {!installation.canCreate ? ' · account owner only' : ''}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Notice icon={Github}>
                        {!ghStatus?.linked
                          ? 'Link GitHub before creating a hosted project.'
                          : 'Authorize a GitHub App installation for this workspace first.'}{' '}
                        <Link to="/settings/account" className="text-link font-medium">
                          Open account settings
                        </Link>
                      </Notice>
                    )}
                    {selectedInstallation?.accountType === 'User' && !ghStatus?.credentialReady && (
                      <Notice tone="warning" role="alert">
                        Renew your GitHub authorization in{' '}
                        <Link to="/settings/account" className="text-link font-medium">
                          account settings
                        </Link>{' '}
                        before InitPad can create a repository in your personal account.
                      </Notice>
                    )}
                    {ghStatus && !ghStatus.ciCallbackReady && (
                      <Notice tone="danger" role="alert">
                        {ghStatus.ciCallbackIssue ?? 'GitHub cannot reach the InitPad CI callback.'}{' '}
                        Configure a public HTTPS{' '}
                        <code className="font-mono">INITPAD_PUBLIC_URL</code> and restart InitPad.
                      </Notice>
                    )}
                  </div>
                )}
              </div>
            </Section>

            <Section
              title="Template"
              description={template?.description ?? 'The language and runtime to start from.'}
              media={<StepBadge step={2} />}
            >
              <div
                role="group"
                aria-label="Template"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              >
                {templates.map((t) => {
                  const selected = t.id === templateId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      aria-pressed={selected}
                      className={cn(
                        'relative flex min-w-0 flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                        selected
                          ? 'border-primary/60 bg-secondary/60'
                          : 'border-border bg-card hover:border-input hover:bg-muted/50',
                      )}
                    >
                      {selected && (
                        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      )}
                      <TemplateIcon templateId={t.id} language={t.language} size="lg" />
                      <div className="w-full">
                        <div className="break-words text-sm font-medium leading-snug">{t.name}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {t.language}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section
              title="Pipeline"
              description="The stages a verified build moves through."
              media={<StepBadge step={3} />}
            >
              <PipelinePresetField value={pipelinePreset} onChange={setPipelinePreset} hideLegend />
            </Section>

            <Section
              title="Deployment targets"
              description="Where each environment runs."
              help={environmentTargetHelp(hosted)}
              helpLabel="About environment targets"
              media={<StepBadge step={4} />}
            >
              <EnvironmentTargetFields
                template={template ?? null}
                targets={targets}
                values={environmentTargets}
                hosted={hosted}
                onChange={chooseTarget}
                environments={selectedStages}
                hideLabel
              />
              {template && capabilityMismatches.length > 0 && (
                <Notice tone="warning" className="mt-3">
                  {capabilityMismatches.map((target) => target.name).join(', ')}{' '}
                  {capabilityMismatches.length === 1 ? 'is' : 'are'} not offered because{' '}
                  {capabilityMismatches.length === 1 ? 'it is' : 'they are'} marked as unable to run{' '}
                  <b className="font-semibold text-foreground">{runtimeOf(template)}</b>.{' '}
                  <Link
                    to="/infrastructure"
                    className="text-link inline-flex items-center gap-1 font-medium"
                  >
                    Update target capabilities <Settings2 className="h-3.5 w-3.5" />
                  </Link>
                </Notice>
              )}
            </Section>
          </div>

          {/* The summary stays in view while the form scrolls and owns the one primary action. */}
          <Card className="p-5 sm:p-6 xl:sticky xl:top-10">
            <h2 className="text-base font-semibold tracking-tight">Summary</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="min-w-0">
                <dt className="eyebrow">Project</dt>
                <dd className="mt-0.5 truncate font-mono text-[13px]" title={name}>
                  {name || '—'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">Template</dt>
                <dd className="mt-0.5 truncate font-medium">{template?.name ?? '—'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="eyebrow">Environments</dt>
                <dd className="mt-1 space-y-1">
                  {selectedStages.map((environment) => (
                    <div key={environment} className="flex min-w-0 items-baseline gap-2">
                      <span className="w-10 shrink-0 text-xs font-semibold uppercase tracking-wide">
                        {environment}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 truncate text-[13px]',
                          !targetName(environment) && 'text-warning',
                        )}
                        title={targetName(environment)}
                      >
                        {targetName(environment) ?? 'No target chosen'}
                      </span>
                    </div>
                  ))}
                </dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-border/70 pt-4 text-xs leading-relaxed text-muted-foreground">
              The project moves through{' '}
              <b className="font-semibold text-foreground">{selectedStages.join(' → ')}</b>.{' '}
              {pipelinePreset === 'prod-only'
                ? 'CI verifies the build without publishing it; request production from the project detail.'
                : 'The first successful CI run deploys to dev; promote the same build from the project detail.'}
            </p>
            <Button className="mt-5 w-full" disabled={!canSubmit} onClick={submit}>
              {busy ? <Spinner className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </Card>
        </div>
      )}

      {busy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[3px] animate-in fade-in"
          role="status"
          aria-live="polite"
        >
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col items-center gap-3 overflow-y-auto rounded-xl border border-border/70 bg-card p-6 text-center shadow-xl animate-in zoom-in-95 sm:p-8">
            <Spinner className="h-7 w-7 text-primary" />
            <div className="break-words text-base font-semibold tracking-tight">
              Setting up “{name}”
            </div>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              <li>Creating {hosted ? 'GitHub' : 'Gitea'} repository</li>
              <li>Generating project scaffold</li>
              <li>Configuring CI and deployment secrets</li>
            </ul>
            <p className="text-xs text-muted-foreground">Redirecting to your project…</p>
          </div>
        </div>
      )}
    </div>
  );
}
