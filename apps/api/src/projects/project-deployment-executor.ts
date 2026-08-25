import { DeploymentService } from '../deployment/deployment.service';
import type { DeploymentAllocation } from '../deployment/deployment-provider.interface';
import { templateRuntime } from '../domain/capability';
import { EnvName, ProviderKind } from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';
import { repositoryRef, ScmActor } from '../scm/scm-provider';
import { TemplatesService } from '../templates/templates.service';
import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';
import { ProjectAgentDelivery } from './project-agent-delivery';
import { artifactImageRef, deploymentSlug, registryImageRef } from './project-deployment-identity';
import { ProjectDeploymentOperations } from './project-deployment-operations';
import { ProjectDeploymentPreparation } from './project-deployment-preparation';
import { ProjectEnvironmentLifecycle } from './project-environment-lifecycle';
import { ProjectEnvironmentTargets } from './project-environment-targets';

/** Executes one already-claimed deployment operation and publishes its result. */
export class ProjectDeploymentExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly deployment: DeploymentService,
    private readonly targets: ProjectEnvironmentTargets,
    private readonly environmentLifecycle: ProjectEnvironmentLifecycle,
    private readonly operations: ProjectDeploymentOperations,
    private readonly preparation: ProjectDeploymentPreparation,
    private readonly artifacts: ProjectArtifactLifecycle,
    private readonly agentDelivery: ProjectAgentDelivery,
    private readonly resolveActor: (projectId: string) => Promise<ScmActor>,
  ) {}

  async execute(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
    operationId: string,
  ): Promise<boolean> {
    await this.operations.advancePhase(
      operationId,
      'assigned',
      'Assigned to control plane',
    );
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const repository = repositoryRef(project);
    const template = this.templates.get(project.templateId);
    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
      include: { target: true, allocation: true, buildArtifact: true },
    });
    let operation = await this.prisma.deploymentOperation.findUnique({
      where: { id: operationId },
      include: { buildArtifact: true },
    });
    const agentBacked =
      environment.provider === 'docker'
      && environment.target?.scope === 'user';
    let testedImageRef: string | undefined;
    if (useRegistry) {
      if (repository.provider === 'github') {
        const artifact = operation?.buildArtifact;
        if (
          !artifact ||
          artifact.projectId !== projectId ||
          artifact.commitSha !== version.toLowerCase() ||
          artifact.status !== 'available' ||
          artifact.storageKind !== 'object-store' ||
          !artifact.storageRef
        ) {
          throw new Error('GitHub deployment has no verified build artifact for this version');
        }
        testedImageRef = artifactImageRef(repository, artifact);
        if (
          !agentBacked
          && !(await this.artifacts.ensureImageAvailable(repository, projectId, artifact.id))
        ) {
          throw new Error('Verified build artifact could not be rehydrated from object storage');
        }
      } else {
        testedImageRef = registryImageRef(repository, version);
        if (agentBacked && !operation?.buildArtifactId) {
          const artifact = await this.artifacts.captureRegistryArtifact(
            repository,
            project,
            operationId,
            version,
          );
          operation = { ...operation!, buildArtifactId: artifact.id, buildArtifact: artifact };
        }
      }
    }

    let allocationId: string | undefined;
    let allocation: DeploymentAllocation | undefined;
    if (environment.targetId) {
      const resolved = await this.targets.ensureAllocation(project.workspaceId, environment.targetId);
      await this.targets.assertAcceptsDeploy(
        resolved.id,
        environment.id,
        templateRuntime(template),
      );
      allocationId = resolved.id;
      allocation = resolved;
    }
    await this.prisma.environment.updateMany({
      where: { projectId, name: envName, activeOperationId: operationId },
      data: {
        status: 'deploying',
        statusReason: null,
        ...(allocationId ? { allocationId } : {}),
      },
    });
    await this.operations.advancePhase(operationId, 'running', 'Preparing deployment');

    if (agentBacked) {
      if (!useRegistry || !testedImageRef || !operation?.buildArtifactId) {
        throw new Error('Agent deployment requires a CI-tested build artifact');
      }
      await this.agentDelivery.queueDeployment(operationId, {
        projectSlug: deploymentSlug(repository),
        imageRef: testedImageRef,
        containerPort: template.port ?? 8080,
        healthPath: template.healthPath ?? '/health',
      });
      // The durable Agent completion owns publication and operation completion.
      return false;
    }

    const appPort = this.environmentLifecycle.usesSharedSshPort(environment)
      ? await this.environmentLifecycle.allocateSharedSshPort(projectId, envName)
      : undefined;
    const reportProgress = (message: string) =>
      this.operations.reportProgress(operationId, projectId, envName, message);
    const prepared = await this.preparation.prepare({
      environmentId: environment.id,
      provider: environment.provider as ProviderKind,
      template,
      repository,
      projectRepoPath: project.repoPath,
      version,
      useRegistry,
      testedImageRef,
      resolveActor: () => this.resolveActor(projectId),
      onProgress: reportProgress,
    });

    try {
      const result = await this.deployment.deploy(environment.provider as ProviderKind, {
        projectName: deploymentSlug(repository),
        version,
        env: envName,
        repoPath: prepared.repoPath,
        port: template.port,
        healthPath: template.healthPath ?? '/health',
        startCommand: template.startCommand,
        artifactDir: prepared.artifactDir,
        webRoot: template.webRoot,
        protectedWebLayout: prepared.protectedWebLayout,
        writableDirs: prepared.writableDirs,
        appPort,
        onProgress: reportProgress,
        connection: this.targets.connection(environment),
        allocation,
        imageRef: testedImageRef,
        allowBuildFallback: !useRegistry,
        envVars: prepared.envVars,
      });
      if (await this.operations.cancelled(operationId)) {
        const teardown = await this.deployment.teardown(environment.provider as ProviderKind, {
          projectName: deploymentSlug(repository),
          env: envName,
          imageRef: testedImageRef,
          connection: this.targets.connection(environment),
          allocation,
        });
        await this.prisma.environment.updateMany({
          where: { projectId, name: envName, activeOperationId: operationId },
          data: this.environmentLifecycle.emptyState(
            teardown?.warning ? `Cleanup pending: ${teardown.warning}` : null,
          ),
        });
        await this.operations.complete(operationId, 'cancelled', 'Cancelled by user');
        return false;
      }
      if (result.status === 'failed') {
        throw new Error(result.reason || `Deployment to '${envName}' failed`);
      }
      const published = await this.prisma.environment.updateMany({
        where: { projectId, name: envName, activeOperationId: operationId },
        data: {
          status: result.status,
          version,
          buildArtifactId: operation?.buildArtifactId ?? null,
          url: result.url,
          statusReason: null,
          deploymentRequired: false,
        },
      });
      return published.count === 1;
    } finally {
      prepared.cleanup();
    }
  }
}
