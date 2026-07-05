import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Rocket, ArrowRight } from 'lucide-react';
import { api, type EnvConfig } from '@/api';
import { useToast } from '@/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/molecules/PageHeader';
import { FormField } from '@/components/molecules/FormField';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import type { EnvName, ProviderKind, TemplateManifest } from '@/types';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

function defaultProvider(env: EnvName, template: TemplateManifest): ProviderKind {
  const wanted: ProviderKind =
    env === 'prod' ? (template.artifact === 'static' ? 'sftp' : 'ssh') : 'docker';
  return template.compatibleProviders.includes(wanted) ? wanted : template.compatibleProviders[0];
}

export default function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [name, setName] = useState('my-project');
  const [templateId, setTemplateId] = useState<string>('');
  const [envs, setEnvs] = useState<EnvConfig[]>([]);
  const [busy, setBusy] = useState(false);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  useEffect(() => {
    api.listTemplates().then((t) => {
      setTemplates(t);
      // "Use template" on the Templates page preselects a template via ?template=id.
      const wanted = params.get('template');
      const preselected = wanted && t.find((x) => x.id === wanted);
      if (preselected) setTemplateId(preselected.id);
      else if (t[0]) setTemplateId(t[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!template) return;
    setEnvs(ENV_ORDER.map((envName) => ({ name: envName, provider: defaultProvider(envName, template) })));
  }, [template]);

  function setProvider(envName: EnvName, provider: ProviderKind) {
    setEnvs((cur) => cur.map((e) => (e.name === envName ? { ...e, provider } : e)));
  }

  async function submit() {
    setBusy(true);
    try {
      const project = await api.createProject(name, templateId, envs);
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
        subtitle="Pick a template and the platform sets up the repository, code, CI/CD and a running app."
      />

      <div className="flex flex-col gap-6">
        <FormField
          label="Project name"
          id="project-name"
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          className="max-w-md"
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
          <Label>Environments</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {envs.map((e, i) => (
              <div key={e.name} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {e.name}
                </span>
                <Select
                  value={e.provider}
                  aria-label={`Provider for ${e.name}`}
                  onChange={(ev) => setProvider(e.name, ev.target.value as ProviderKind)}
                >
                  {template?.compatibleProviders.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
                {i < envs.length - 1 && (
                  <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          <Rocket className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
          <span>
            The project moves through <b className="font-semibold text-foreground">dev → test → prod</b>.
            After creation it is deployed to <b className="font-semibold text-foreground">dev</b>;
            promote to test and prod manually from the detail page.
          </span>
        </div>

        <div>
          <Button disabled={busy || !templateId} onClick={submit}>
            {busy ? <Spinner className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>

      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm animate-in fade-in">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center shadow-xl animate-in zoom-in-95">
            <Spinner className="h-7 w-7 text-primary" />
            <div className="text-sm font-semibold">Setting up “{name}”</div>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              <li>Creating Git repository</li>
              <li>Generating project scaffold</li>
              <li>Booting the dev environment</li>
            </ul>
            <p className="text-xs text-muted-foreground">Redirecting to your project…</p>
          </div>
        </div>
      )}
    </div>
  );
}
