import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AlertTriangle, Check, Rocket, DownloadCloud, Github, Settings2 } from 'lucide-react';
import { api, type EnvConfig, type GitHubStatus } from '@/api';
import { useToast } from '@/toast';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/molecules/PageHeader';
import { FormField } from '@/components/molecules/FormField';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import {
  ENV_NAMES,
  EnvironmentTargetFields,
  suggestedEnvironmentTargets,
  type EnvironmentTargets,
} from '@/components/organisms/EnvironmentTargetFields';
import type { EnvName, RuntimeKind, Target, TemplateManifest } from '@/types';

function runtimeOf(t: TemplateManifest): RuntimeKind {
  return t.runtime ?? (t.artifact === 'static' ? 'static' : 'node');
}

export default function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspace, user } = useAuth();
  const readOnly = activeWorkspace?.role === 'viewer';
  const [params] = useSearchParams();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [name, setName] = useState('my-project');
  const [templateId, setTemplateId] = useState<string>('');
  const [environmentTargets, setEnvironmentTargets] = useState<EnvironmentTargets>({ dev: '', test: '', prod: '' });
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [scmInstallationId, setScmInstallationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const validName = /^[a-z][a-z0-9-]{1,40}$/.test(name);
  const hosted = user?.edition === 'saas';

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
    () => ghStatus?.installations.find((installation) => installation.id === scmInstallationId) ?? null,
    [ghStatus, scmInstallationId],
  );
  const githubReady = !hosted || Boolean(
    ghStatus?.linked &&
    selectedInstallation &&
    ghStatus?.ciCallbackReady &&
    !selectedInstallation.suspended &&
    selectedInstallation.canCreate &&
    (selectedInstallation.accountType === 'Organization' || ghStatus.credentialReady),
  );

  useEffect(() => {
    Promise.all([
      api.listTemplates(),
      api.listTargets(),
      hosted ? api.githubStatus() : Promise.resolve(null),
    ]).then(([t, tg, github]) => {
      setTemplates(t);
      setTargets(tg);
      setGhStatus(github);
      const firstInstallation = github?.installations.find(
        (installation) => !installation.suspended && installation.canCreate,
      );
      setScmInstallationId(firstInstallation?.id ?? '');
      // "Use template" on the Templates page preselects a template via ?template=id.
      const wanted = params.get('template');
      const preselected = wanted && t.find((x) => x.id === wanted);
      if (preselected) setTemplateId(preselected.id);
      else if (t[0]) setTemplateId(t[0].id);
    }).catch((error) => setLoadError((error as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, activeWorkspace?.id]);

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
    if (readOnly || !validName || !templateId || !githubReady || ENV_NAMES.some((name) => !environmentTargets[name])) return;
    setBusy(true);
    try {
      const environments: EnvConfig[] = ENV_NAMES.map((environment) => ({
        name: environment,
        targetId: environmentTargets[environment],
      }));
      const project = await api.createProject(
        name,
        templateId,
        environments,
        hosted ? scmInstallationId : undefined,
      );
      toast.success('Project created');
      navigate(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New project"
        subtitle="Pick a golden path and the platform prepares source code, a Git repository and a deployment pipeline."
      />

      <Link to="/import" className="text-link mb-4 inline-flex items-center gap-1 text-sm font-medium">
        <DownloadCloud className="h-4 w-4" /> Import an existing repository instead
      </Link>

      {loadError && <p role="alert" className="mb-4 text-sm text-destructive">{loadError}</p>}
      {readOnly && <p role="alert" className="mb-4 rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">Viewer access is read-only. Ask a workspace admin for a member or maintainer role to create projects.</p>}

      <div className="flex flex-col gap-6">
        <FormField
          label="Project name"
          id="project-name"
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className="max-w-md"
          error={name && !validName ? 'Use 2–41 lowercase letters, digits or hyphens; start with a letter.' : null}
          aria-invalid={name && !validName ? true : undefined}
        />

        {hosted && (
          <div className="flex max-w-md flex-col gap-1.5">
            <Label htmlFor="repository-owner">GitHub repository owner</Label>
            {ghStatus?.linked && ghStatus.installations.length > 0 ? (
              <>
                <Select
                  id="repository-owner"
                  value={scmInstallationId}
                  aria-label="GitHub repository owner"
                  onChange={(event) => setScmInstallationId(event.target.value)}
                >
                  <option value="" disabled>Choose an account or organization…</option>
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
                <p className="text-xs text-muted-foreground">
                  InitPad creates a private repository in this GitHub account. Only installations
                  authorized for {activeWorkspace?.name ?? 'this workspace'} are shown.
                </p>
              </>
            ) : (
              <div className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                <Github className="mr-2 inline h-4 w-4" />
                {!ghStatus?.linked
                  ? 'Link GitHub before creating a hosted project.'
                  : 'Authorize a GitHub App installation for this workspace first.'}{' '}
                <Link to="/settings" className="text-link font-medium">Open Settings</Link>
              </div>
            )}
            {selectedInstallation?.accountType === 'User' && !ghStatus?.credentialReady && (
              <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-muted-foreground">
                Renew your GitHub authorization in <Link to="/settings" className="text-link font-medium">Settings</Link>{' '}
                before InitPad can create a repository in your personal account.
              </p>
            )}
            {ghStatus && !ghStatus.ciCallbackReady && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-muted-foreground">
                <AlertTriangle className="mr-2 inline h-4 w-4 text-destructive" />
                {ghStatus.ciCallbackIssue ?? 'GitHub cannot reach the InitPad CI callback.'}{' '}
                Configure a public HTTPS <code className="font-mono">INITPAD_PUBLIC_URL</code> and restart InitPad.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>Template</Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {templates.map((t) => {
              const selected = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  aria-pressed={selected}
                  className={cn(
                    'relative flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    selected
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <TemplateIcon templateId={t.id} language={t.language} size="lg" />
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.language}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <EnvironmentTargetFields
            template={template ?? null}
            targets={targets}
            values={environmentTargets}
            hosted={hosted}
            onChange={chooseTarget}
          />
          {template && capabilityMismatches.length > 0 && (
            <div className="mt-2 flex max-w-2xl items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                {capabilityMismatches.map((target) => target.name).join(', ')}{' '}
                {capabilityMismatches.length === 1 ? 'is' : 'are'} not offered because{' '}
                {capabilityMismatches.length === 1 ? 'it is' : 'they are'} marked as unable to run{' '}
                <b className="font-semibold text-foreground">{runtimeOf(template)}</b>.{' '}
                <Link to="/infrastructure" className="text-link inline-flex items-center gap-1 font-medium">
                  Update target capabilities <Settings2 className="h-3.5 w-3.5" />
                </Link>
              </span>
            </div>
          )}
          {template && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{template.description}</p>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          <Rocket className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
          <span>
            The project moves through <b className="font-semibold text-foreground">dev → test → prod</b>.
            The first successful CI run deploys to <b className="font-semibold text-foreground">dev</b>;
            promote to test and prod manually from the detail page.
          </span>
        </div>

        <div>
          <Button disabled={readOnly || busy || !templateId || !validName || !githubReady || !!loadError || ENV_NAMES.some((environment) => !environmentTargets[environment])} onClick={submit}>
            {busy ? <Spinner className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>

      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm animate-in fade-in" role="status" aria-live="polite">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center shadow-xl animate-in zoom-in-95">
            <Spinner className="h-7 w-7 text-primary" />
            <div className="text-sm font-semibold">Setting up “{name}”</div>
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
