import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/molecules/EmptyState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DetailSection } from '@/components/molecules/DetailSection';
import { EnvironmentPipeline } from '@/components/organisms/EnvironmentPipeline';
import { DeleteProjectDialog } from '@/components/organisms/DeleteProjectDialog';
import { TargetPickerDialog } from '@/components/organisms/TargetPickerDialog';
import { EnvVarsDialog } from '@/components/organisms/EnvVarsDialog';
import { ProjectHistory } from '@/components/organisms/ProjectHistory';
import { ProjectRepository } from '@/components/organisms/ProjectRepository';
import { ProjectSummary } from '@/components/organisms/ProjectSummary';
import { useProjectDetail } from '@/hooks/useProjectDetail';

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
    targetEnv,
    configEnv,
    targets,
    readOnly,
    canMaintain,
    setConfirmOpen,
    setTargetEnv,
    setConfigEnv,
    toggleCommit,
    promote,
    redeploy,
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
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (loading && !project) return <Skeleton />;
  if (!project) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const commitsBySha = Object.fromEntries(commits.map((c) => [c.sha, c] as const));

  return (
    <div>
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
          onRunAgain={runAgain}
          onRerunFailedJobs={rerunFailedJobs}
          onStop={stopEnvironment}
          onStart={startEnvironment}
          onRemoveEnv={removeEnvironment}
          onConfigureTarget={setTargetEnv}
          readOnly={readOnly}
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
    </div>
  );
}
