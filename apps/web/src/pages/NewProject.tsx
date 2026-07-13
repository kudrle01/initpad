import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Check, Rocket, ArrowRight, Container } from 'lucide-react';
import { api, type EnvConfig } from '@/api';
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
import type { RuntimeKind, Target, TemplateManifest } from '@/types';

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

export default function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspace } = useAuth();
  const readOnly = activeWorkspace?.role === 'viewer';
  const [params] = useSearchParams();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [name, setName] = useState('my-project');
  const [templateId, setTemplateId] = useState<string>('');
  const [prodTargetId, setProdTargetId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const validName = /^[a-z][a-z0-9-]{1,40}$/.test(name);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  const prodOptions = useMemo(
    () => (template ? targets.filter((t) => usable(t, template)) : []),
    [targets, template],
  );

  const dockerTarget = useMemo(
    () => targets.find((t) => t.scope === 'builtin' && t.kind === 'docker') ?? null,
    [targets],
  );

  useEffect(() => {
    Promise.all([api.listTemplates(), api.listTargets()]).then(([t, tg]) => {
      setTemplates(t);
      setTargets(tg);
      // "Use template" on the Templates page preselects a template via ?template=id.
      const wanted = params.get('template');
      const preselected = wanted && t.find((x) => x.id === wanted);
      if (preselected) setTemplateId(preselected.id);
      else if (t[0]) setTemplateId(t[0].id);
    }).catch((error) => setLoadError((error as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default prod to the template's natural target (static→SFTP, node→SSH,
  // otherwise Docker); the user can change it here or later.
  useEffect(() => {
    if (!template) return;
    const rt = runtimeOf(template);
    const kind = rt === 'static' ? 'sftp' : rt === 'node' ? 'ssh' : 'docker';
    const opts = targets.filter((t) => usable(t, template));
    const natural =
      opts.find((t) => t.scope === 'builtin' && t.kind === kind) ??
      opts.find((t) => t.scope === 'builtin' && t.kind === 'docker') ??
      opts[0];
    setProdTargetId(natural?.id ?? '');
  }, [template, targets]);

  async function submit() {
    if (readOnly || !validName || !templateId) return;
    setBusy(true);
    try {
      // dev/test use the built-in infra by default (server-side); prod uses the
      // chosen target.
      const environments: EnvConfig[] = [
        { name: 'dev' },
        { name: 'test' },
        { name: 'prod', targetId: prodTargetId || undefined },
      ];
      const project = await api.createProject(name, templateId, environments);
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
          <Label>Environments &amp; targets</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {(['dev', 'test'] as const).map((envName) => (
              <div key={envName} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {envName}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground">
                  <Container className="h-3.5 w-3.5" /> {dockerTarget?.name ?? 'Built-in Docker'}
                </span>
                <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                prod
              </span>
              <Select
                value={prodTargetId}
                aria-label="Production target"
                onChange={(ev) => setProdTargetId(ev.target.value)}
              >
                {prodOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.scope === 'user' ? ' (yours)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            dev &amp; test run on the built-in infrastructure. Choose where prod deploys — or
            register your own server in{' '}
            <Link to="/infrastructure" className="text-primary hover:underline">
              Infrastructure
            </Link>
            .
          </p>
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
          <Button disabled={readOnly || busy || !templateId || !validName || !!loadError} onClick={submit}>
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
              <li>Creating Git repository</li>
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
