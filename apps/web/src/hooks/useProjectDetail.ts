import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type DeleteProjectOptions } from '@/api';
import { useAuth } from '@/auth';
import { cleanupNotice } from '@/lib/deployment';
import {
  ACTIVE_PROJECT_POLL_MS,
  IDLE_PROJECT_POLL_MS,
  mergeCommitHead,
} from '@/lib/commit-polling';
import { useToast } from '@/toast';
import type {
  Commit,
  DeploymentOperation,
  EnvName,
  Project,
  ProvisioningStatus,
  RollbackPreview,
  Target,
  TemplateManifest,
} from '@/types';

const DETAIL_COMMIT_LIMIT = 6;

function isLive(project: Project | null, commits: Commit[], rerunRequested: boolean): boolean {
  const environmentBusy =
    project?.environments.some((environment) => environment.status === 'deploying') ?? false;
  const ciBusy = commits.some((commit) =>
    commit.pipeline.some((stage) => stage.status === 'running'),
  );
  const head = commits[0];
  const ciQueued =
    !!head &&
    head.sha !== 'initial' &&
    head.pipeline.some((stage) => stage.status === 'pending') &&
    !head.pipeline.some((stage) => stage.status === 'failed');
  return environmentBusy || ciBusy || ciQueued || rerunRequested;
}

export function useProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { workspaces } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [template, setTemplate] = useState<TemplateManifest | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [deployments, setDeployments] = useState<DeploymentOperation[]>([]);
  const [provisioning, setProvisioning] = useState<ProvisioningStatus | null>(null);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ciRerunRequested, setCiRerunRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null);
  const [targetEnv, setTargetEnv] = useState<EnvName | null>(null);
  const [configEnv, setConfigEnv] = useState<EnvName | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const pollInFlight = useRef(false);

  const projectRole = workspaces.find(
    (workspace) => workspace.id === project?.workspaceId,
  )?.role;
  const readOnly = projectRole === 'viewer';
  const canMaintain =
    projectRole === 'owner' || projectRole === 'admin' || projectRole === 'maintainer';

  const load = useCallback(async (mode: 'full' | 'head' = 'full') => {
    if (!id) return;
    if (mode === 'head' && pollInFlight.current) return;
    if (mode === 'head') pollInFlight.current = true;
    try {
      const [projectRow, commitRows, provisioningRow, deploymentRows] = await Promise.all([
        api.getProject(id),
        api.getCommits(id, mode === 'head' ? 1 : DETAIL_COMMIT_LIMIT).catch(() => [] as Commit[]),
        api.getProvisioning(id).catch(() => null),
        api.getDeployments(id).catch(() => [] as DeploymentOperation[]),
      ]);
      setProject(projectRow);
      setCommits((current) =>
        mode === 'head'
          ? mergeCommitHead(current, commitRows, DETAIL_COMMIT_LIMIT)
          : commitRows,
      );
      setProvisioning(provisioningRow ?? null);
      setDeployments(deploymentRows);
      setOpenSha((current) => current ?? commitRows[0]?.sha ?? null);
      setError(null);
      setNotFound(false);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 404) {
        // A project can disappear while this tab remains open (delete in
        // another tab or control-plane restore). Never leave stale actions
        // visible once the authoritative read says it is gone.
        setProject(null);
        setCommits([]);
        setDeployments([]);
        setProvisioning(null);
        setError(null);
        setNotFound(true);
      } else {
        setError((loadError as Error).message);
      }
    } finally {
      if (mode === 'head') pollInFlight.current = false;
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setProject(null);
    setTemplate(null);
    setCommits([]);
    setDeployments([]);
    setProvisioning(null);
    setOpenSha(null);
    setError(null);
    setNotFound(false);
    setRollbackPreview(null);
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (notFound) return;
    // During a short API restart retain the last useful view with a visible
    // warning, but retry quickly instead of waiting for the idle interval.
    const delay = error || isLive(project, commits, ciRerunRequested)
      ? ACTIVE_PROJECT_POLL_MS
      : IDLE_PROJECT_POLL_MS;
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') void load('head');
    }, delay);
    return () => clearTimeout(timer);
  }, [project, commits, load, error, notFound, ciRerunRequested]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load('head');
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [load]);

  useEffect(() => {
    if (!ciRerunRequested) return;
    const devVersion = project?.environments.find(
      (environment) => environment.name === 'dev',
    )?.version;
    const deployedCommit = commits.find((commit) => commit.sha === devVersion);
    const latestAttemptVisible = deployedCommit?.pipeline.some(
      (stage) => stage.name === 'deploy' && ['running', 'success'].includes(stage.status),
    );
    if (latestAttemptVisible) setCiRerunRequested(false);
  }, [ciRerunRequested, commits, project]);

  useEffect(() => {
    if (!ciRerunRequested) return;
    const timeout = setTimeout(() => setCiRerunRequested(false), 120_000);
    return () => clearTimeout(timeout);
  }, [ciRerunRequested]);

  useEffect(() => {
    if (!project) return;
    api
      .listTemplates()
      .then((templates) =>
        setTemplate(templates.find((candidate) => candidate.id === project.templateId) ?? null),
      )
      .catch(() => undefined);
  }, [project]);

  useEffect(() => {
    api.listTargets().then(setTargets).catch(() => undefined);
  }, []);

  async function promote(target: EnvName) {
    if (!id) return;
    setBusy(target);
    try {
      setProject(await api.promote(id, target));
      toast.success(`Deploying to ${target}…`);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function redeploy(environment: EnvName) {
    if (!id) return;
    setBusy(`redeploy-${environment}`);
    try {
      setProject(await api.redeploy(id, environment));
      toast.success(
        project?.scm.provider === 'github'
          ? `Deploying the verified build to ${environment} through InitPad — no new GitHub runner is required.`
          : `Redeploying ${environment}`,
      );
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function requestRollback(environment: EnvName) {
    if (!id) return;
    setBusy(`rollback-preview-${environment}`);
    try {
      const preview = await api.getRollbackPreview(id, environment);
      if (!preview) {
        toast.warning(`No previous verified ${environment} deployment is available to roll back.`);
        return;
      }
      setRollbackPreview(preview);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmRollback() {
    if (!id || !rollbackPreview) return;
    setBusy(`rollback-${rollbackPreview.environment}`);
    try {
      setProject(await api.rollback(
        id,
        rollbackPreview.environment,
        rollbackPreview.candidateOperationId,
        rollbackPreview.stateToken,
      ));
      toast.success(
        `Rolling back ${rollbackPreview.environment} to ${rollbackPreview.rollbackVersion.slice(0, 7)} without a new CI build.`,
      );
      setRollbackPreview(null);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runAgain() {
    if (!id) return;
    setBusy('run-again-dev');
    try {
      setProject(await api.runAgain(id));
      toast.success(
        project?.scm.provider === 'github'
          ? 'Preparing dev deployment through InitPad. An existing verified build is reused when available.'
          : 'Preparing dev deployment…',
      );
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function rerunFailedJobs() {
    if (!id) return;
    setBusy('rerun-failed-jobs');
    try {
      const { runId } = await api.rerunFailedJobs(id);
      setCiRerunRequested(true);
      toast.success(`GitHub is re-running failed jobs from run ${runId}.`);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function environmentAction(
    key: string,
    environment: EnvName,
    action: (projectId: string, environmentName: EnvName) => Promise<Project>,
    successMessage: string,
  ) {
    if (!id) return;
    setBusy(`${key}-${environment}`);
    try {
      setProject(await action(id, environment));
      toast.success(successMessage);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const stopEnvironment = (environment: EnvName) =>
    environmentAction('stop', environment, api.stopEnv, `Stopped ${environment}`);
  const startEnvironment = (environment: EnvName) =>
    environmentAction('start', environment, api.startEnv, `Starting ${environment}`);

  async function removeEnvironment(environment: EnvName) {
    if (!id) return;
    setBusy(`remove-${environment}`);
    try {
      const updated = await api.removeEnv(id, environment);
      setProject(updated);
      const warning = updated.environments.find(
        (candidate) => candidate.name === environment,
      )?.statusReason;
      if (warning) toast.warning(cleanupNotice(warning));
      else toast.success(`Removed ${environment} deployment`);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function bindTarget(environment: EnvName, targetId: string) {
    if (!id) return;
    setBusy(`target-${environment}`);
    try {
      setProject(await api.bindEnvTarget(id, environment, targetId));
      toast.success(`Updated ${environment} target`);
      setTargetEnv(null);
    } catch (actionError) {
      toast.error((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteProject(options: DeleteProjectOptions) {
    if (!id || !project) return;
    setDeleting(true);
    try {
      await api.deleteProject(id, options);
      toast.success(`Deleted ${project.name}`);
      navigate('/');
    } catch (actionError) {
      try {
        setProject(await api.getProject(id));
      } catch {
        // A completed deletion with an interrupted response is reconciled by
        // the next navigation; keep the original action error visible.
      }
      toast.error((actionError as Error).message);
      setDeleting(false);
    }
  }

  function retryLoad() {
    setError(null);
    setNotFound(false);
    setLoading(true);
    void load();
  }

  return {
    project,
    template,
    commits,
    deployments,
    provisioning,
    openSha,
    error,
    notFound,
    busy,
    loading,
    deleting,
    confirmOpen,
    rollbackPreview,
    targetEnv,
    configEnv,
    targets,
    readOnly,
    canMaintain,
    setConfirmOpen,
    setRollbackPreview,
    setTargetEnv,
    setConfigEnv,
    retryLoad,
    toggleCommit: (sha: string) =>
      setOpenSha((current) => (current === sha ? null : sha)),
    promote,
    redeploy,
    requestRollback,
    confirmRollback,
    runAgain,
    rerunFailedJobs,
    stopEnvironment,
    startEnvironment,
    removeEnvironment,
    bindTarget,
    deleteProject,
  };
}
