import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, KeyRound, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DetailSection } from '@/components/molecules/DetailSection';
import { Disclosure } from '@/components/molecules/Disclosure';
import { listRowClassName, listRowInteractiveClassName } from '@/components/molecules/List';
import { EnvironmentPipeline } from '@/components/organisms/EnvironmentPipeline';
import { DeleteProjectDialog } from '@/components/organisms/DeleteProjectDialog';
import { TargetPickerDialog } from '@/components/organisms/TargetPickerDialog';
import { RollbackDialog } from '@/components/organisms/RollbackDialog';
import { EnvVarsDialog } from '@/components/organisms/EnvVarsDialog';
import { WorkloadDiagnosticsDialog } from '@/components/organisms/WorkloadDiagnosticsDialog';
import { ProjectHistory } from '@/components/organisms/ProjectHistory';
import { ProjectRepository } from '@/components/organisms/ProjectRepository';
import { ProjectSummary } from '@/components/organisms/ProjectSummary';
import { ProductionApprovalCard } from '@/components/organisms/ProductionApprovalCard';
import { PipelinePresetSettings } from '@/components/organisms/PipelinePresetSettings';
import { useProjectDetail } from '@/hooks/useProjectDetail';
import { useConfirmation } from '@/confirmation';
import { cn } from '@/lib/utils';
import type { EnvName, PipelinePreset } from '@/types';
import { t } from '@/i18n';

export default function ProjectDetail() {
  const confirmAction = useConfirmation();
  const {
    project,
    template,
    commits,
    deployments,
    provisioning,
    productionRequest,
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
    hosted,
    setConfirmOpen,
    setRollbackPreview,
    setTargetEnv,
    setConfigEnv,
    setDiagnosticEnv,
    refreshDetails,
    retryLoad,
    toggleCommit,
    promote,
    redeploy,
    requestRollback,
    confirmRollback,
    requestProduction,
    approveProduction,
    rejectProduction,
    cancelProduction,
    runAgain,
    rerunFailedJobs,
    stopEnvironment,
    startEnvironment,
    removeEnvironment,
    bindTarget,
    updatePipelinePreset,
    deleteProject,
  } = useProjectDetail();

  if (notFound) {
    return (
      <div>
        <PageHeader title={t('Project not found')} />
        <EmptyState
          icon={Layers}
          title={t("This project doesn't exist")}
          description={t('Check the address, or head back to your projects.')}
          action={
            <Button asChild>
              <Link to="/projects">
                <ArrowLeft className="h-4 w-4" /> {t('Back to projects')}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (error && !project) return <LoadErrorState message={error} onRetry={retryLoad} />;
  if (loading && !project) {
    return <ContentLoading label={t('Loading project')} variant="detail" />;
  }
  if (!project) return <ContentLoading label={t('Loading project')} variant="detail" />;

  const currentProject = project;
  const commitsBySha = Object.fromEntries(commits.map((c) => [c.sha, c] as const));

  async function promoteWithConfirmation(target: EnvName) {
    if (target === 'prod') {
      const productionIndex = currentProject.environments.findIndex(
        (environment) => environment.name === 'prod',
      );
      const source =
        productionIndex > 0 ? currentProject.environments[productionIndex - 1] : undefined;
      const verifiedBuild = source?.artifact
        ? {
            version: source.version,
            digest: source.artifact.digest,
            label: source.name,
          }
        : currentProject.latestVerifiedArtifact
          ? {
              version: currentProject.latestVerifiedArtifact.version,
              digest: currentProject.latestVerifiedArtifact.digest,
              label: 'CI',
            }
          : null;
      const confirmed = await confirmAction({
        title: t('Request production deployment?'),
        description: t(
          'The exact verified {source} build, target and production configuration revision will be locked for review.',
          { source: verifiedBuild?.label ?? t('source') },
        ),
        confirmLabel: t('Create request'),
        tone: 'warning',
        details: [
          { label: t('Project'), value: currentProject.name },
          {
            label: t('Version'),
            value: verifiedBuild?.version?.slice(0, 7) ?? t('not available'),
          },
          {
            label: t('Artifact digest'),
            value: (
              <span className="break-all font-mono text-xs">
                {verifiedBuild?.digest ?? t('not available')}
              </span>
            ),
          },
          {
            label: t('Target'),
            value:
              currentProject.environments.find((environment) => environment.name === 'prod')?.target
                ?.name ?? t('production'),
          },
        ],
        consequences: [
          t('No production workload changes until an authorized reviewer approves.'),
          t('Changing the build, target or production variables invalidates this request.'),
        ],
      });
      if (confirmed) await requestProduction('promote');
      return;
    }
    await promote(target);
  }

  async function redeployWithConfirmation(environment: EnvName) {
    if (environment === 'prod') {
      const current = currentProject.environments.find(
        (candidate) => candidate.name === environment,
      );
      const confirmed = await confirmAction({
        title: t('Request production redeploy?'),
        description: t(
          'The current verified production build and configuration revision will be submitted for review.',
        ),
        confirmLabel: t('Create request'),
        tone: 'warning',
        details: [
          { label: t('Project'), value: currentProject.name },
          { label: t('Version'), value: current?.version?.slice(0, 7) ?? t('not available') },
          {
            label: t('Artifact digest'),
            value: (
              <span className="break-all font-mono text-xs">
                {current?.artifact?.digest ?? t('not available')}
              </span>
            ),
          },
          { label: t('Target'), value: current?.target?.name ?? t('production') },
        ],
        consequences: [
          t('No production workload changes until an authorized reviewer approves.'),
          t('Changing the target or production variables invalidates this request.'),
        ],
      });
      if (confirmed) await requestProduction('redeploy');
      return;
    }
    await redeploy(environment);
  }

  async function approveProductionWithConfirmation() {
    if (!productionRequest) return;
    const confirmed = await confirmAction({
      title: t('Approve and deploy to production?'),
      description: t(
        'Approval starts deployment of the exact reviewed build to the recorded production target.',
      ),
      confirmLabel: t('Approve and deploy'),
      tone: 'danger',
      details: [
        { label: t('Project'), value: currentProject.name },
        { label: t('Version'), value: productionRequest.version.slice(0, 12) },
        {
          label: t('Artifact digest'),
          value: (
            <span className="break-all font-mono text-xs">
              {productionRequest.artifact?.digest ?? t('not available')}
            </span>
          ),
        },
        { label: t('Target'), value: productionRequest.target.name },
      ],
      consequences: [
        t(
          'Production is changed only if the reviewed target and configuration revision still match.',
        ),
        t('The action and resulting deployment are recorded separately in the audit log.'),
      ],
    });
    if (confirmed) await approveProduction();
  }

  async function rejectProductionWithConfirmation() {
    const confirmed = await confirmAction({
      title: t('Reject production request?'),
      description: t('The reviewed build will not be deployed by this request.'),
      confirmLabel: t('Reject request'),
      tone: 'warning',
    });
    if (confirmed) await rejectProduction();
  }

  async function cancelProductionWithConfirmation() {
    const confirmed = await confirmAction({
      title: t('Cancel production request?'),
      description: t('The pending request will no longer be available for approval.'),
      confirmLabel: t('Cancel request'),
      tone: 'warning',
    });
    if (confirmed) await cancelProduction();
  }

  async function stopWithConfirmation(environment: EnvName) {
    const current = currentProject.environments.find((candidate) => candidate.name === environment);
    const confirmed = await confirmAction({
      title: t('Stop the {environment} environment?', { environment: environment }),
      description: t(
        'The deployment record is preserved, but the application will stop serving traffic.',
      ),
      confirmLabel: t('Stop {environment}', { environment: environment }),
      tone: environment === 'prod' ? 'danger' : 'warning',
      details: [
        { label: t('Project'), value: currentProject.name },
        { label: t('Target'), value: current?.target?.name ?? current?.provider ?? t('unknown') },
      ],
      consequences: [
        t('The environment becomes unavailable until it is started again.'),
        t('The deployed version and configuration remain recorded.'),
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
        ? t('Cancel the {environment} deployment?', { environment: environment })
        : cleanupPending
          ? t('Retry cleanup for {environment}?', { environment: environment })
          : t('Remove the {environment} deployment?', { environment: environment }),
      description: cancelling
        ? t('InitPad will cancel the active operation and clean up any managed partial workload.')
        : t('InitPad will remove the managed workload from its assigned target.'),
      confirmLabel: cancelling
        ? t('Cancel deployment')
        : cleanupPending
          ? t('Retry cleanup')
          : t('Remove deployment'),
      tone: 'danger',
      details: [
        { label: t('Environment'), value: environment.toUpperCase() },
        { label: t('Target'), value: current?.target?.name ?? current?.provider ?? t('unknown') },
      ],
      consequences: [
        t('The public application for this environment becomes unavailable.'),
        cancelling
          ? t('Any earlier verified builds remain in project history and can be deployed again.')
          : t('The verified build remains in project history and can be deployed again.'),
        t('InitPad never deletes unrelated files or the physical target.'),
      ],
    });
    if (confirmed) await removeEnvironment(environment);
  }

  async function changePipelinePresetWithConfirmation(
    preset: PipelinePreset,
    environments: Array<{ name: EnvName; targetId?: string }>,
  ) {
    const currentNames = new Set(
      currentProject.environments.map((environment) => environment.name),
    );
    const removed = currentProject.environments.filter(
      (environment) => !environments.some((candidate) => candidate.name === environment.name),
    );
    const added = environments.filter((environment) => !currentNames.has(environment.name));
    const confirmed = await confirmAction({
      title: t('Change project pipeline?'),
      description: t('The configured deployment stages will change for future operations.'),
      confirmLabel: t('Change pipeline'),
      tone: 'warning',
      details: [
        { label: t('Preset'), value: preset },
        { label: t('Added'), value: added.map((stage) => stage.name).join(', ') || 'none' },
        { label: t('Removed'), value: removed.map((stage) => stage.name).join(', ') || 'none' },
      ],
      consequences: [
        t('A removed stage must already be empty and have no pending cleanup.'),
        t('Production remains protected by a separate approval request.'),
      ],
    });
    if (confirmed) await updatePipelinePreset(preset, environments);
  }

  const stages = project.environments.map((environment) => environment.name).join(' → ');

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {error && <LoadErrorState message={error} onRetry={retryLoad} />}
      <ProjectSummary
        project={project}
        template={template}
        provisioning={provisioning}
        canMaintain={canMaintain}
        onDelete={() => setConfirmOpen(true)}
      />

      <section aria-labelledby="environments-heading">
        <h2 id="environments-heading" className="mb-3 text-base font-semibold tracking-tight">
          {t('Environments')}
        </h2>
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
        {productionRequest && (
          <ProductionApprovalCard
            request={productionRequest}
            projectId={currentProject.id}
            busy={busy !== null}
            onApprove={() => void approveProductionWithConfirmation()}
            onReject={() => void rejectProductionWithConfirmation()}
            onCancel={() => void cancelProductionWithConfirmation()}
          />
        )}
      </section>

      {/* History is the main column; reference material and rarely changed
          settings sit beside it instead of pushing it down the page. */}
      <div className="grid items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <ProjectHistory
            project={project}
            commits={commits}
            deployments={deployments}
            openSha={openSha}
            onToggleCommit={toggleCommit}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <ProjectRepository project={project} />

          <DetailSection
            title={t('Configuration')}
            description={t('Variables and secrets injected at deploy. Redeploy to apply changes.')}
            flush
          >
            <ul className="divide-y divide-border/70">
              {project.environments.map((env) => (
                <li key={env.name}>
                  <button
                    type="button"
                    onClick={() => setConfigEnv(env.name)}
                    aria-label={t('{name} variables', { name: env.name })}
                    className={cn(
                      listRowClassName,
                      listRowInteractiveClassName,
                      'w-full text-left',
                    )}
                  >
                    <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold uppercase tracking-wide">{env.name}</span>{' '}
                      <span className="text-muted-foreground">{t('variables')}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  </button>
                </li>
              ))}
            </ul>
          </DetailSection>

          <DetailSection
            title={t('Pipeline')}
            description={
              <span className="font-mono text-xs font-medium uppercase tracking-wide">
                {stages}
              </span>
            }
          >
            <Disclosure
              summary={canMaintain ? t('Change pipeline') : t('Pipeline options')}
              className="-mt-2"
              contentClassName="pt-3"
            >
              <PipelinePresetSettings
                project={project}
                template={template}
                targets={targets}
                hosted={hosted}
                canMaintain={canMaintain}
                busy={busy === 'pipeline-preset'}
                onSave={(preset, environments) =>
                  void changePipelinePresetWithConfirmation(preset, environments)
                }
              />
            </Disclosure>
          </DetailSection>
        </div>
      </div>

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
        onChanged={refreshDetails}
      />

      <WorkloadDiagnosticsDialog
        projectId={project.id}
        environment={
          project.environments.find((environment) => environment.name === diagnosticEnv) ?? null
        }
        onOpenChange={(open) => !open && setDiagnosticEnv(null)}
      />
    </div>
  );
}
