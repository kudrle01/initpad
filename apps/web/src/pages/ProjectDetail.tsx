import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitBranch, Layers, MoreHorizontal, Trash2, ExternalLink } from 'lucide-react';
import { api, ApiError, type DeleteProjectOptions } from '@/api';
import { useToast } from '@/toast';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { CopyField } from '@/components/molecules/CopyField';
import { EmptyState } from '@/components/molecules/EmptyState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { EnvironmentPipeline } from '@/components/organisms/EnvironmentPipeline';
import { CommitList } from '@/components/organisms/CommitList';
import { DeleteProjectDialog } from '@/components/organisms/DeleteProjectDialog';
import { EnvLogsDialog } from '@/components/organisms/EnvLogsDialog';
import { TargetPickerDialog } from '@/components/organisms/TargetPickerDialog';
import { giteaLink } from '@/lib/utils';
import type { Commit, EnvName, Project, Target, TemplateManifest } from '@/types';

// After creation the project finishes in the background (dev: deploying →
// running) and CI runs asynchronously — while anything is "working", the
// detail refreshes itself periodically.
function isLive(project: Project | null, commits: Commit[]): boolean {
  const envBusy = project?.environments.some((e) => e.status === 'deploying') ?? false;
  const ciBusy = commits.some((c) => c.pipeline.some((s) => s.status === 'running'));
  // The head commit is waiting for the runner (pending, nothing failed) →
  // keep refreshing so the stages start moving without a manual reload.
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
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [logsEnv, setLogsEnv] = useState<EnvName | null>(null);
  const [targetEnv, setTargetEnv] = useState<EnvName | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const toast = useToast();
  const { workspaces } = useAuth();
  const projectRole = workspaces.find((workspace) => workspace.id === project?.workspaceId)?.role;
  const readOnly = projectRole === 'viewer';
  const canMaintain = projectRole === 'owner' || projectRole === 'admin' || projectRole === 'maintainer';
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
      // 404 = the project is gone (deleted here, or its repository was
      // removed in Gitea and reconciliation cleaned it up) → dedicated page.
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (notFound) return;
    // Fast cadence while something is working; a slow heartbeat otherwise so
    // out-of-band changes (repo deleted in Gitea, new commits) surface
    // without a manual refresh. Server-side reconciliation runs on each read.
    const t = setTimeout(load, isLive(project, commits) ? 2500 : 10_000);
    return () => clearTimeout(t);
  }, [project, commits, load, notFound]);

  useEffect(() => {
    if (!project) return;
    api
      .listTemplates()
      .then((all) => setTemplate(all.find((t) => t.id === project.templateId) ?? null))
      .catch(() => {});
  }, [project]);

  useEffect(() => {
    api.listTargets().then(setTargets).catch(() => {});
  }, []);

  async function promote(target: EnvName) {
    if (!id) return;
    setBusy(target);
    try {
      setProject(await api.promote(id, target));
      toast.success(`Deploying to ${target}…`);
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

  async function runAgain() {
    if (!id) return;
    setBusy('run-again-dev');
    try {
      setProject(await api.runAgain(id));
      toast.success('Running dev again…');
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
  async function removeEnvironment(env: EnvName) {
    if (!id) return;
    setBusy(`remove-${env}`);
    try {
      const updated = await api.removeEnv(id, env);
      setProject(updated);
      const warning = updated.environments.find((item) => item.name === env)?.statusReason;
      if (warning) toast.warning(warning);
      else toast.success(`Removed ${env} deployment`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function bindTarget(env: EnvName, targetId: string) {
    if (!id) return;
    setBusy(`target-${env}`);
    try {
      setProject(await api.bindEnvTarget(id, env, targetId));
      toast.success(`Updated ${env} target`);
      setTargetEnv(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(options: DeleteProjectOptions) {
    if (!id || !project) return;
    setDeleting(true);
    try {
      await api.deleteProject(id, options);
      toast.success(`Deleted ${project.name}`);
      navigate('/');
    } catch (e) {
      // Teardown may have removed the public workload and converted a
      // foreign-owned remainder into explicit cleanup debt. Refresh while the
      // dialog stays open so the user immediately sees the quarantined paths
      // and can make the separate, informed detach decision without a manual
      // page reload.
      try {
        setProject(await api.getProject(id));
      } catch {
        // If the delete actually completed but its response was interrupted,
        // the next normal navigation/reconciliation will reflect that state.
      }
      toast.error((e as Error).message);
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div>
        <PageHeader title="Project not found" />
        <EmptyState
          icon={Layers}
          title="This project doesn't exist"
          description="Check the address, or head back to your projects."
          action={
            <Button asChild>
              <Link to="/projects">
                <ArrowLeft className="h-4 w-4" /> Back to projects
              </Link>
            </Button>
          }
        />
      </div>
    );
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
  // Latest CI run link (build/deploy pipeline) for the runner-logs shortcut.
  const runnerUrl =
    commits[0]?.pipeline.find((s) => s.url)?.url ??
    (project.repoUrl ? `${giteaLink(project.repoUrl)}/actions` : null);

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
          {canMaintain && <DropdownMenu>
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
          </DropdownMenu>}
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
          onRunAgain={runAgain}
          onStop={stopEnvironment}
          onStart={startEnvironment}
          onRemoveEnv={removeEnvironment}
          onConfigureTarget={setTargetEnv}
          onOpenLogs={openLogs}
          readOnly={readOnly}
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
        environments={project.environments}
        hasRepository={!!project.repoUrl}
        deleting={deleting}
        onConfirm={doDelete}
      />

      <EnvLogsDialog
        env={logsEnv}
        projectName={project.name}
        status={logsStatus}
        logsText={logsText}
        logsLoading={logsLoading}
        runnerUrl={runnerUrl}
        onOpenChange={(o) => !o && setLogsEnv(null)}
        onRefresh={() => logsEnv && openLogs(logsEnv)}
      />

      <TargetPickerDialog
        env={targetEnv}
        current={project.environments.find((x) => x.name === targetEnv)?.target ?? null}
        template={template}
        targets={targets}
        busy={busy === `target-${targetEnv}`}
        onOpenChange={(o) => !o && setTargetEnv(null)}
        onPick={bindTarget}
      />
    </div>
  );
}
