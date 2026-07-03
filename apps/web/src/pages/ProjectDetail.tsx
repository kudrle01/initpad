import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitBranch, MoreHorizontal, Trash2, ExternalLink } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/toast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { CopyField } from '@/components/molecules/CopyField';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { EnvironmentPipeline } from '@/components/organisms/EnvironmentPipeline';
import { CommitList } from '@/components/organisms/CommitList';
import { DeleteProjectDialog } from '@/components/organisms/DeleteProjectDialog';
import { EnvLogsDialog } from '@/components/organisms/EnvLogsDialog';
import { giteaLink } from '@/lib/utils';
import type { Commit, EnvName, Project, TemplateManifest } from '@/types';

// Projekt se po vytvoření dotahuje na pozadí (dev: deploying → running) a CI
// běží asynchronně – dokud něco „pracuje", detail se sám periodicky obnovuje.
function isLive(project: Project | null, commits: Commit[]): boolean {
  const envBusy = project?.environments.some((e) => e.status === 'deploying') ?? false;
  const ciBusy = commits.some((c) => c.pipeline.some((s) => s.status === 'running'));
  // Poslední commit čeká na runner (pending, nic neselhalo) → taky obnovovat,
  // ať se stavy rozjedou samy bez ručního refreshe.
  const head = commits[0];
  const ciQueued =
    !!head &&
    head.sha !== 'initial' &&
    head.pipeline.some((s) => s.status === 'pending') &&
    !head.pipeline.some((s) => s.status === 'failed');
  return envBusy || ciBusy || ciQueued;
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-44 rounded bg-secondary" />
      <div className="mt-3 h-4 w-64 rounded bg-secondary" />
      <div className="mt-6 flex gap-3">
        <div className="h-32 flex-1 rounded-lg bg-secondary" />
        <div className="h-32 flex-1 rounded-lg bg-secondary" />
        <div className="h-32 flex-1 rounded-lg bg-secondary" />
      </div>
      <div className="mt-6 h-4 w-28 rounded bg-secondary" />
      <div className="mt-3 h-16 w-full rounded-lg bg-secondary" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [template, setTemplate] = useState<TemplateManifest | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [logsEnv, setLogsEnv] = useState<EnvName | null>(null);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const fetchLogs = useCallback(
    (envName: EnvName, silent: boolean) => {
      if (!id) return;
      if (!silent) {
        setLogsText('');
        setLogsLoading(true);
      }
      api
        .getLogs(id, envName)
        .then((r) => setLogsText(r.logs || '(no output)'))
        .catch((e) => setLogsText(`Error: ${(e as Error).message}`))
        .finally(() => {
          if (!silent) setLogsLoading(false);
        });
    },
    [id],
  );

  const openLogs = useCallback(
    (envName: EnvName) => {
      setLogsEnv(envName);
      fetchLogs(envName, false);
    },
    [fetchLogs],
  );

  useEffect(() => {
    if (!logsEnv) return;
    const t = setInterval(() => fetchLogs(logsEnv, true), 2500);
    return () => clearInterval(t);
  }, [logsEnv, fetchLogs]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, c] = await Promise.all([
        api.getProject(id),
        api.getCommits(id).catch(() => [] as Commit[]),
      ]);
      setProject(p);
      setCommits(c);
      setOpenSha((cur) => cur ?? c[0]?.sha ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!isLive(project, commits)) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [project, commits, load]);

  useEffect(() => {
    if (!project) return;
    api
      .listTemplates()
      .then((all) => setTemplate(all.find((t) => t.id === project.templateId) ?? null))
      .catch(() => {});
  }, [project]);

  async function promote(target: EnvName) {
    if (!id) return;
    setBusy(target);
    try {
      setProject(await api.promote(id, target));
      toast.success(`Promoted to ${target}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function redeploy(envName: EnvName) {
    if (!id) return;
    setBusy(`redeploy-${envName}`);
    try {
      setProject(await api.redeploy(id, envName));
      toast.success(`Redeploying ${envName}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function envAction(
    key: string,
    envName: EnvName,
    fn: (id: string, env: EnvName) => Promise<Project>,
    okMsg: string,
  ) {
    if (!id) return;
    setBusy(`${key}-${envName}`);
    try {
      setProject(await fn(id, envName));
      toast.success(okMsg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const stopEnvironment = (env: EnvName) => envAction('stop', env, api.stopEnv, `Stopped ${env}`);
  const startEnvironment = (env: EnvName) => envAction('start', env, api.startEnv, `Starting ${env}`);
  const removeEnvironment = (env: EnvName) =>
    envAction('remove', env, api.removeEnv, `Removed ${env} deployment`);

  async function doDelete() {
    if (!id || !project) return;
    setDeleting(true);
    try {
      await api.deleteProject(id);
      toast.success(`Deleted ${project.name}`);
      navigate('/');
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (loading && !project) return <Skeleton />;
  if (!project) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const created = new Date(project.createdAt).toLocaleDateString('en-GB');
  const cloneUrl = project.repoUrl ? `${project.repoUrl}.git` : null;
  const logsStatus = logsEnv
    ? project.environments.find((x) => x.name === logsEnv)?.status
    : undefined;
  const commitsBySha = Object.fromEntries(commits.map((c) => [c.sha, c] as const));

  return (
    <div>
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TemplateIcon templateId={project.templateId} language={template?.language} />
          <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {project.repoUrl && (
            <Button asChild variant="secondary">
              <a href={giteaLink(project.repoUrl)} target="_blank" rel="noreferrer">
                <GitBranch className="h-4 w-4" /> Open repo
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                <Trash2 className="h-4 w-4" /> Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {template?.name ?? project.templateId} · created {created}
      </p>

      <Section title="Repository">
        {project.repoUrl && (
          <a
            href={giteaLink(project.repoUrl)}
            target="_blank"
            rel="noreferrer"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <GitBranch className="h-4 w-4" /> {project.repoUrl}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {cloneUrl && <CopyField command={`git clone ${cloneUrl}`} />}
        <p className="mt-2 text-xs text-muted-foreground">
          Private repository — first time?{' '}
          <Link to="/settings" className="text-primary hover:underline">
            Connect Git
          </Link>{' '}
          once and cloning works without a password.
        </p>
      </Section>

      <Section title="Environments">
        <EnvironmentPipeline
          project={project}
          busy={busy}
          commitsBySha={commitsBySha}
          onPromote={promote}
          onRedeploy={redeploy}
          onStop={stopEnvironment}
          onStart={startEnvironment}
          onRemoveEnv={removeEnvironment}
          onOpenLogs={openLogs}
        />
      </Section>

      <Section title="Commits">
        <CommitList
          commits={commits}
          repoUrl={project.repoUrl}
          openSha={openSha}
          onToggle={(sha) => setOpenSha((cur) => (cur === sha ? null : sha))}
        />
      </Section>

      <DeleteProjectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        projectName={project.name}
        deleting={deleting}
        onConfirm={doDelete}
      />

      <EnvLogsDialog
        env={logsEnv}
        projectName={project.name}
        status={logsStatus}
        logsText={logsText}
        logsLoading={logsLoading}
        onOpenChange={(o) => !o && setLogsEnv(null)}
        onRefresh={() => logsEnv && openLogs(logsEnv)}
      />
    </div>
  );
}
