import { BadRequestException } from '@nestjs/common';
import { config } from '../config';
import { DeploymentService } from '../deployment/deployment.service';
import { EnvName, ProviderKind } from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';
import { repositoryRef } from '../scm/scm-provider';
import { TemplatesService } from '../templates/templates.service';
import { ProjectDeploymentOperations } from './project-deployment-operations';
import { deployedImageRef, deploymentSlug } from './project-deployment-identity';
import { ProjectEnvironmentTargets } from './project-environment-targets';

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Start, stop and removal state machine for one project environment. */
export class ProjectEnvironmentLifecycle {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly deployment: DeploymentService,
    private readonly targets: ProjectEnvironmentTargets,
    private readonly operations: ProjectDeploymentOperations,
  ) {}

  async stop(projectId: string, envName: EnvName): Promise<void> {
    const { environment, slug } = await this.context(projectId, envName);
    if (environment.activeOperationId) {
      throw new BadRequestException(`Environment '${envName}' has an active operation`);
    }
    if (environment.status !== 'running') {
      throw new BadRequestException(`Environment '${envName}' is not running`);
    }
    await this.deployment.stop(environment.provider as ProviderKind, {
      projectName: slug,
      env: envName,
      connection: this.targets.connection(environment),
      allocation: this.targets.allocation(environment),
    });
    await this.prisma.environment.update({
      where: { projectId_name: { projectId, name: envName } },
      data: { status: 'stopped', statusReason: null },
    });
  }

  async start(projectId: string, envName: EnvName): Promise<void> {
    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (!environment.version) {
      throw new BadRequestException(`Environment '${envName}' has nothing to start`);
    }
    if (environment.status !== 'stopped') {
      throw new BadRequestException(`Environment '${envName}' is not stopped`);
    }
    const operationId = await this.operations.begin(
      projectId,
      envName,
      'start',
      environment.version,
    );
    void this.startInBackground(projectId, envName, operationId);
  }

  async remove(projectId: string, envName: EnvName): Promise<void> {
    const { project, environment, slug } = await this.context(projectId, envName);
    const repository = repositoryRef(project);
    if (environment.activeOperationId) {
      const operation = await this.prisma.deploymentOperation.findUnique({
        where: { id: environment.activeOperationId },
      });
      // A CI retry is only waiting for the SCM workflow. Finish it
      // synchronously so an eventual callback cannot revive this environment.
      if (operation?.kind === 'ci-retry') {
        await this.prisma.$transaction([
          this.prisma.deploymentOperation.update({
            where: { id: operation.id },
            data: {
              status: 'cancelled',
              message: 'Cancellation requested by user',
              finishedAt: new Date(),
            },
          }),
          this.prisma.environment.update({
            where: { id: environment.id },
            data: this.emptyState(),
          }),
        ]);
        return;
      }
      await this.prisma.$transaction([
        this.prisma.deploymentOperation.update({
          where: { id: environment.activeOperationId },
          data: { status: 'cancelled', message: 'Cancellation requested by user' },
        }),
        this.prisma.environment.update({
          where: { id: environment.id },
          data: { statusReason: 'Cancellation requested — cleaning up' },
        }),
      ]);
      return;
    }
    const teardown = await this.deployment.teardown(environment.provider as ProviderKind, {
      projectName: slug,
      env: envName,
      imageRef: deployedImageRef(repository, environment),
      connection: this.targets.connection(environment),
      allocation: this.targets.allocation(environment),
    });
    await this.prisma.environment.update({
      where: { projectId_name: { projectId, name: envName } },
      data: this.emptyState(
        teardown?.warning ? `Cleanup pending: ${teardown.warning}` : null,
      ),
    });
  }

  usesSharedSshPort(environment: {
    provider: string;
    target?: { scope: string } | null;
  }): boolean {
    return environment.provider === 'ssh' && environment.target?.scope !== 'user';
  }

  async allocateSharedSshPort(projectId: string, envName: EnvName): Promise<number> {
    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (environment.allocatedPort) return environment.allocatedPort;

    const { appPortBase, appPortSlots } = config.providers.ssh;
    const used = await this.prisma.environment.findMany({
      where: { allocatedPort: { not: null } },
      select: { allocatedPort: true },
    });
    const taken = new Set(used.map((item) => item.allocatedPort));
    for (let port = appPortBase; port < appPortBase + appPortSlots; port++) {
      if (taken.has(port)) continue;
      try {
        await this.prisma.environment.update({
          where: { projectId_name: { projectId, name: envName } },
          data: { allocatedPort: port },
        });
        return port;
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        // Another deployment acquired this port after our initial read.
      }
    }
    throw new Error(
      `No free application ports on the SSH target (range ${appPortBase}–${appPortBase + appPortSlots - 1} is full). ` +
        'Remove unused deployments or widen INITPAD_SSH_APP_PORT_SLOTS.',
    );
  }

  private async startInBackground(
    projectId: string,
    envName: EnvName,
    operationId: string,
  ): Promise<void> {
    try {
      const { project, template, environment, slug } = await this.context(projectId, envName);
      const repository = repositoryRef(project);
      const appPort = this.usesSharedSshPort(environment)
        ? await this.allocateSharedSshPort(projectId, envName)
        : undefined;
      const result = await this.deployment.start(environment.provider as ProviderKind, {
        projectName: slug,
        env: envName,
        port: template.port,
        healthPath: template.healthPath ?? '/health',
        startCommand: template.startCommand,
        version: environment.version ?? undefined,
        appPort,
        connection: this.targets.connection(environment),
        allocation: this.targets.allocation(environment),
      });
      if (await this.operations.cancelled(operationId)) {
        const teardown = await this.deployment.teardown(environment.provider as ProviderKind, {
          projectName: slug,
          env: envName,
          imageRef: deployedImageRef(repository, environment),
          connection: this.targets.connection(environment),
          allocation: this.targets.allocation(environment),
        });
        await this.prisma.environment.updateMany({
          where: { projectId, name: envName, activeOperationId: operationId },
          data: this.emptyState(
            teardown?.warning ? `Cleanup pending: ${teardown.warning}` : null,
          ),
        });
        await this.operations.complete(operationId, 'cancelled', 'Cancelled by user');
        return;
      }
      await this.prisma.environment.updateMany({
        where: { projectId, name: envName, activeOperationId: operationId },
        data: {
          status: result.status,
          url: result.url,
          statusReason: result.status === 'failed' ? (result.reason ?? null) : null,
        },
      });
      await this.operations.complete(
        operationId,
        result.status === 'failed' ? 'failed' : 'succeeded',
        result.reason,
      );
    } catch (error) {
      await this.prisma.environment
        .updateMany({
          where: { projectId, name: envName, activeOperationId: operationId },
          data: {
            status: 'failed',
            statusReason: (error as Error).message,
            activeOperationId: null,
          },
        })
        .catch(() => undefined);
      await this.operations.complete(operationId, 'failed', (error as Error).message);
    }
  }

  private async context(projectId: string, envName: EnvName) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const template = this.templates.get(project.templateId);
    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
      include: { target: true, allocation: true, buildArtifact: true },
    });
    return {
      project,
      template,
      environment,
      slug: deploymentSlug(repositoryRef(project)),
    };
  }

  emptyState(statusReason: string | null = null) {
    return {
      status: 'empty',
      version: null,
      buildArtifactId: null,
      url: null,
      statusReason,
      allocatedPort: null,
      activeOperationId: null,
      deploymentRequired: false,
    } as const;
  }
}
