import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, DownloadCloud } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/toast';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/molecules/PageHeader';
import { Spinner } from '@/components/atoms/Spinner';
import type { ImportableRepo, ImportPreflight, TemplateManifest } from '@/types';

// Import an existing repository: pick a repo + template, run a preflight against
// the runtime contract, then record the project without touching the code.
export default function ImportRepo() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspace } = useAuth();
  const readOnly = activeWorkspace?.role === 'viewer';

  const [repos, setRepos] = useState<ImportableRepo[]>([]);
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listImportableRepos(), api.listTemplates()])
      .then(([r, t]) => {
        setRepos(r);
        setTemplates(t);
        if (t[0]) setTemplateId(t[0].id);
        const firstImportable = r.find((x) => !x.alreadyImported && !x.empty);
        if (firstImportable) setRepositoryId(firstImportable.repositoryId);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  // A fresh choice invalidates the previous preflight.
  useEffect(() => setPreflight(null), [repositoryId, templateId]);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repositoryId === repositoryId) ?? null,
    [repos, repositoryId],
  );

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
    if (readOnly || !preflight?.canImport) return;
    setBusy(true);
    try {
      const project = await api.importRepo(repositoryId, templateId);
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

      <Link to="/new" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Start from a template instead
      </Link>

      {loadError && <p role="alert" className="mb-4 text-sm text-destructive">{loadError}</p>}
      {readOnly && (
        <p role="alert" className="mb-4 rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">
          Viewer access is read-only. Ask a workspace admin for a member or maintainer role to import projects.
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
            <p className="text-xs text-muted-foreground">No repositories available to import.</p>
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
              <Button disabled={readOnly || busy || !preflight.canImport} onClick={doImport}>
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
