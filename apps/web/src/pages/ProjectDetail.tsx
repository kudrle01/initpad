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

export default function ProjectDetail() {
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

  const commitsBySha = Object.fromEntries(commits.map((c) => [c.sha, c] as const));

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
          onPromote={promote}
          onRedeploy={redeploy}
          onRollback={requestRollback}
          onRunAgain={runAgain}
          onRerunFailedJobs={rerunFailedJobs}
          onStop={stopEnvironment}
          onStart={startEnvironment}
          onRemoveEnv={removeEnvironment}
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
