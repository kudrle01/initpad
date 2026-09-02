import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DetailSection } from '@/components/molecules/DetailSection';
import { EnvironmentPipeline } from '@/components/organisms/EnvironmentPipeline';
import { DeleteProjectDialog } from '@/components/organisms/DeleteProjectDialog';
import { TargetPickerDialog } from '@/components/organisms/TargetPickerDialog';
import { RollbackDialog } from '@/components/organisms/RollbackDialog';
import { EnvVarsDialog } from '@/components/organisms/EnvVarsDialog';
import { WorkloadDiagnosticsDialog } from '@/components/organisms/WorkloadDiagnosticsDialog';
import { ProjectHistory } from '@/components/organisms/ProjectHistory';
import { ProjectRepository } from '@/components/organisms/ProjectRepository';
import { ProjectSummary } from '@/components/organisms/ProjectSummary';
import { useProjectDetail } from '@/hooks/useProjectDetail';
import { useConfirmation } from '@/confirmation';
import type { EnvName } from '@/types';

export default function ProjectDetail() {
  const confirmAction = useConfirmation();
  const {
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
    diagnosticEnv,
    targets,
    readOnly,
    canMaintain,
    setConfirmOpen,
    setRollbackPreview,
    setTargetEnv,
    setConfigEnv,
    setDiagnosticEnv,
    retryLoad,
    toggleCommit,
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
  } = useProjectDetail();

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
  if (error && !project) return <LoadErrorState message={error} onRetry={retryLoad} />;
  if (loading && !project) {
    return <ContentLoading label="Loading project" variant="detail" />;
  }
  if (!project) return <ContentLoading label="Loading project" variant="detail" />;

  const currentProject = project;
  const commitsBySha = Object.fromEntries(commits.map((c) => [c.sha, c] as const));

  async function promoteWithConfirmation(target: EnvName) {
    if (target === 'prod') {
      const source = currentProject.environments.find((environment) => environment.name === 'test');
      const confirmed = await confirmAction({
        title: 'Deploy the test build to production?',
        description: 'This publishes the currently verified test artifact to the production target.',
        confirmLabel: 'Deploy to production',
        tone: 'danger',
        details: [
          { label: 'Project', value: currentProject.name },
          { label: 'Version', value: source?.version?.slice(0, 7) ?? 'not available' },
          { label: 'Target', value: currentProject.environments.find((environment) => environment.name === 'prod')?.target?.name ?? 'production' },
        ],
        consequences: [
          'The production workload is replaced after target health checks pass.',
          'Production keeps its own current environment variables and secrets.',
        ],
      });
      if (!confirmed) return;
    }
    await promote(target);
  }

  async function redeployWithConfirmation(environment: EnvName) {
    if (environment === 'prod') {
      const current = currentProject.environments.find((candidate) => candidate.name === environment);
      const confirmed = await confirmAction({
        title: 'Redeploy the verified production build?',
        description: 'InitPad will publish the same immutable artifact again without rebuilding it.',
        confirmLabel: 'Redeploy production',
        tone: 'danger',
        details: [
          { label: 'Project', value: currentProject.name },
          { label: 'Version', value: current?.version?.slice(0, 7) ?? 'not available' },
          { label: 'Target', value: current?.target?.name ?? 'production' },
        ],
        consequences: [
          'The production target runs its deployment and health-check sequence again.',
          'A direct-port target may publish a new port; stable gateway routing keeps its hostname.',
        ],
      });
      if (!confirmed) return;
    }
    await redeploy(environment);
  }

  async function stopWithConfirmation(environment: EnvName) {
    const current = currentProject.environments.find((candidate) => candidate.name === environment);
    const confirmed = await confirmAction({
      title: `Stop the ${environment} environment?`,
      description: 'The deployment record is preserved, but the application will stop serving traffic.',
      confirmLabel: `Stop ${environment}`,
      tone: environment === 'prod' ? 'danger' : 'warning',
      details: [
        { label: 'Project', value: currentProject.name },
        { label: 'Target', value: current?.target?.name ?? current?.provider ?? 'unknown' },
      ],
      consequences: [
        'The environment becomes unavailable until it is started again.',
        'The deployed version and configuration remain recorded.',
      ],
    });
    if (confirmed) await stopEnvironment(environment);
  }

  async function removeWithConfirmation(environment: EnvName) {
    const current = currentProject.environments.find((candidate) => candidate.name === environment);
    const cancelling = current?.status === 'deploying';
    const cleanupPending = current?.status === 'empty' && Boolean(current.statusReason);
    const confirmed = await confirmAction({
      title: cancelling
        ? `Cancel the ${environment} deployment?`
        : cleanupPending
          ? `Retry cleanup for ${environment}?`
          : `Remove the ${environment} deployment?`,
      description: cancelling
        ? 'InitPad will cancel the active operation and clean up any managed partial workload.'
        : 'InitPad will remove the managed workload from its assigned target.',
      confirmLabel: cancelling ? 'Cancel deployment' : cleanupPending ? 'Retry cleanup' : 'Remove deployment',
      tone: 'danger',
      details: [
        { label: 'Environment', value: environment.toUpperCase() },
        { label: 'Target', value: current?.target?.name ?? current?.provider ?? 'unknown' },
      ],
      consequences: [
        'The public application for this environment becomes unavailable.',
        cancelling
          ? 'Any earlier verified builds remain in project history and can be deployed again.'
          : 'The verified build remains in project history and can be deployed again.',
        'InitPad never deletes unrelated files or the physical target.',
      ],
    });
    if (confirmed) await removeEnvironment(environment);
  }

  return (
    <div>
      {error && (
        <LoadErrorState className="mb-4" message={error} onRetry={retryLoad} />
      )}
      <ProjectSummary
        project={project}
        template={template}
        provisioning={provisioning}
        canMaintain={canMaintain}
        onDelete={() => setConfirmOpen(true)}
      />

      <ProjectRepository project={project} />

      <DetailSection title="Environments">
        <EnvironmentPipeline
          project={project}
          busy={busy}
          commitsBySha={commitsBySha}
          onPromote={(target) => void promoteWithConfirmation(target)}
          onRedeploy={(environment) => void redeployWithConfirmation(environment)}
          onRollback={requestRollback}
          onRunAgain={runAgain}
          onRerunFailedJobs={rerunFailedJobs}
          onStop={(environment) => void stopWithConfirmation(environment)}
          onStart={startEnvironment}
          onRemoveEnv={(environment) => void removeWithConfirmation(environment)}
          onConfigureTarget={setTargetEnv}
          onDiagnostics={setDiagnosticEnv}
          readOnly={readOnly}
          canRollback={canMaintain}
        />
      </DetailSection>

      <DetailSection title="Configuration">
        <p className="mb-3 text-sm text-muted-foreground">
          Environment variables and secrets injected into each environment at deploy. Redeploy to
          apply changes.
        </p>
        <div className="flex flex-wrap gap-2">
          {project.environments.map((env) => (
            <Button
              key={env.name}
              variant="secondary"
              size="sm"
              onClick={() => setConfigEnv(env.name)}
            >
              <Layers className="h-4 w-4" /> {env.name} variables
            </Button>
          ))}
        </div>
      </DetailSection>

      <ProjectHistory
        project={project}
        commits={commits}
        deployments={deployments}
        openSha={openSha}
        onToggleCommit={toggleCommit}
      />

      <DeleteProjectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        projectName={project.name}
        environments={project.environments}
        hasRepository={!!project.repoUrl}
        deleting={deleting}
        onConfirm={deleteProject}
      />

      <RollbackDialog
        preview={rollbackPreview}
        busy={busy === `rollback-${rollbackPreview?.environment}`}
        onOpenChange={(open) => !open && setRollbackPreview(null)}
        onConfirm={confirmRollback}
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

      <EnvVarsDialog
        projectId={project.id}
        env={configEnv}
        canManage={canMaintain}
        onOpenChange={(o) => !o && setConfigEnv(null)}
      />

      <WorkloadDiagnosticsDialog
        projectId={project.id}
        environment={project.environments.find(
          (environment) => environment.name === diagnosticEnv,
        ) ?? null}
        onOpenChange={(open) => !open && setDiagnosticEnv(null)}
      />
    </div>
  );
}
