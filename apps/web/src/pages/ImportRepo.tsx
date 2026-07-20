import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, DownloadCloud, Github } from 'lucide-react';
import { api, type GitHubStatus } from '@/api';
import { useToast } from '@/toast';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/molecules/PageHeader';
import { Spinner } from '@/components/atoms/Spinner';
import {
  ENV_NAMES,
  EnvironmentTargetFields,
  suggestedEnvironmentTargets,
  type EnvironmentTargets,
} from '@/components/organisms/EnvironmentTargetFields';
import type { EnvName, ImportableRepo, ImportPreflight, Target, TemplateManifest } from '@/types';

// Import an existing repository: pick a repo + template, run a preflight against
// the runtime contract, then record the project without touching the code.
export default function ImportRepo() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspace, user } = useAuth();
  const readOnly = activeWorkspace?.role === 'viewer';
  const hosted = user?.edition === 'saas';

  const [repos, setRepos] = useState<ImportableRepo[]>([]);
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [environmentTargets, setEnvironmentTargets] = useState<EnvironmentTargets>({ dev: '', test: '', prod: '' });

  useEffect(() => {
    Promise.all([
      api.listImportableRepos(),
      api.listTemplates(),
      api.listTargets(),
      hosted ? api.githubStatus() : Promise.resolve(null),
    ])
      .then(([r, t, targetRows, github]) => {
        setRepos(r);
        setTemplates(t);
        setTargets(targetRows);
        setGhStatus(github);
        if (t[0]) setTemplateId(t[0].id);
        const firstImportable = r.find((x) => !x.alreadyImported && !x.empty);
        if (firstImportable) setRepositoryId(firstImportable.repositoryId);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [hosted, activeWorkspace?.id]);

  // A fresh choice invalidates the previous preflight.
  useEffect(() => setPreflight(null), [repositoryId, templateId]);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repositoryId === repositoryId) ?? null,
    [repos, repositoryId],
  );
  const template = useMemo(
    () => templates.find((item) => item.id === templateId) ?? null,
    [templates, templateId],
  );

  useEffect(() => {
    setEnvironmentTargets(suggestedEnvironmentTargets(template, targets, hosted));
  }, [template, targets, hosted]);

  function chooseTarget(environment: EnvName, targetId: string) {
    setEnvironmentTargets((current) => ({ ...current, [environment]: targetId }));
  }

  async function runPreflight() {
    if (!repositoryId || !templateId) return;
    setChecking(true);
    try {
      setPreflight(await api.importPreflight(repositoryId, templateId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function doImport() {
    if (readOnly || !preflight?.canImport || ENV_NAMES.some((name) => !environmentTargets[name])) return;
    setBusy(true);
    try {
      const project = await api.importRepo(
        repositoryId,
        templateId,
        ENV_NAMES.map((environment) => ({ name: environment, targetId: environmentTargets[environment] })),
      );
      toast.success('Repository imported');
      navigate(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Import existing repository"
        subtitle="Connect a repository you already have. Import never changes your code — it records the project, wires CI and prepares environments."
      />

      <Link to="/new" className="text-link mb-4 inline-flex items-center gap-1 text-sm font-medium">
        <ArrowLeft className="h-4 w-4" /> Start from a template instead
      </Link>

      {loadError && <p role="alert" className="mb-4 text-sm text-destructive">{loadError}</p>}
      {readOnly && (
        <p role="alert" className="mb-4 rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">
          Viewer access is read-only. Ask a workspace admin for a member or maintainer role to import projects.
        </p>
      )}
      {hosted && ghStatus && !ghStatus.ciCallbackReady && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mr-2 inline h-4 w-4 text-destructive" />
          {ghStatus.ciCallbackIssue ?? 'GitHub cannot reach the InitPad CI callback.'}{' '}
          Configure a public HTTPS <code className="font-mono">INITPAD_PUBLIC_URL</code> before importing.
        </p>
      )}

      <div className="flex max-w-2xl flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label>Repository</Label>
          <Select
            value={repositoryId}
            aria-label="Repository"
            onChange={(e) => setRepositoryId(e.target.value)}
          >
            <option value="" disabled>Choose a repository…</option>
            {repos.map((r) => (
              <option
                key={`${r.provider}:${r.repositoryId}`}
                value={r.repositoryId}
                disabled={r.alreadyImported || r.empty}
              >
                {r.fullName}
                {r.alreadyImported ? ' — already imported' : r.empty ? ' — empty' : ''}
              </option>
            ))}
          </Select>
          {repos.length === 0 && !loadError && (
            hosted && ghStatus?.installations.length === 0 ? (
              <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                <Github className="mr-2 inline h-4 w-4" />
                No GitHub installation is authorized for this workspace.{' '}
                <Link to="/settings" className="text-link font-medium">Open Settings</Link>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No repositories available to import.</p>
            )
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Runtime template</Label>
          <Select value={templateId} aria-label="Template" onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t.language}</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Pick the runtime contract the repository follows. Import checks it, but never rewrites your code.
          </p>
        </div>

        <EnvironmentTargetFields
          template={template}
          targets={targets}
          values={environmentTargets}
          hosted={hosted}
          onChange={chooseTarget}
        />

        <div>
          <Button variant="secondary" onClick={runPreflight} disabled={!repositoryId || !templateId || checking}>
            {checking ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {checking ? 'Checking…' : 'Run preflight check'}
          </Button>
        </div>

        {preflight && (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-[15px] font-semibold">Preflight — {preflight.repo}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Default branch</dt>
              <dd className="font-medium">{preflight.branch}</dd>
              <dt className="text-muted-foreground">Runtime</dt>
              <dd className="font-medium">{preflight.runtime}</dd>
              <dt className="text-muted-foreground">Dockerfile</dt>
              <dd className="font-medium">{preflight.hasDockerfile ? 'found' : 'not found'}</dd>
              <dt className="text-muted-foreground">InitPad workflow</dt>
              <dd className="font-medium">{preflight.hasCompatibleWorkflow ? 'compatible' : 'not found'}</dd>
            </dl>
            {preflight.warnings.length > 0 && (
              <ul className="mt-4 flex flex-col gap-1.5">
                {preflight.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span className="text-muted-foreground">{w}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5">
              <Button
                disabled={
                  readOnly ||
                  busy ||
                  !preflight.canImport ||
                  (hosted && !ghStatus?.ciCallbackReady) ||
                  ENV_NAMES.some((environment) => !environmentTargets[environment])
                }
                onClick={doImport}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <DownloadCloud className="h-4 w-4" />}
                {busy ? 'Importing…' : `Import ${selectedRepo?.name ?? 'repository'}`}
              </Button>
              {!preflight.canImport && (
                <p className="mt-2 text-xs text-muted-foreground">Resolve the issues above before importing.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
