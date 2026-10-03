import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ControlPlaneLeaseService } from '../common/control-plane-lease.service';
import { ProjectsService } from './projects.service';

const ENVIRONMENT_EXPIRY_SWEEP_MS = 60_000;
const PROJECTS_LEASE_TTL_MS = 3 * ENVIRONMENT_EXPIRY_SWEEP_MS;
const PROJECTS_LEASE_NAME = 'projects-lifecycle';

/** Owns leader-elected startup recovery and periodic project maintenance. */
@Injectable()
export class ProjectsLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ProjectsLifecycleService');
  private maintenanceTimer?: NodeJS.Timeout;
  private maintenance?: Promise<void>;
  private leaderGeneration?: number;

  constructor(
    private readonly projects: ProjectsService,
    private readonly leases: ControlPlaneLeaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.maintenanceTimer = setInterval(
      () =>
        void this.runLeaderCycle().catch((error) =>
          this.logger.warn(`Project lifecycle lease skipped: ${(error as Error).message}`),
        ),
      ENVIRONMENT_EXPIRY_SWEEP_MS,
    );
    this.maintenanceTimer.unref();
    try {
      await this.runLeaderCycle();
    } catch (error) {
      this.onModuleDestroy();
      throw error;
    }
  }

  onModuleDestroy(): void {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = undefined;
  }

  private async runLeaderCycle(): Promise<void> {
    const claim = await this.leases.acquire(PROJECTS_LEASE_NAME, PROJECTS_LEASE_TTL_MS);
    if (!claim || this.maintenance) return;

    const becameLeader = this.leaderGeneration !== claim.generation;
    const maintenance = this.runMaintenance(becameLeader, claim.generation);
    this.maintenance = maintenance;
    await maintenance.finally(() => {
      if (this.maintenance === maintenance) this.maintenance = undefined;
    });
  }

  private async runMaintenance(becameLeader: boolean, generation: number): Promise<void> {
    if (becameLeader) {
      await this.projects.reconcilePersistedState();
      await this.projects
        .runArtifactRetention()
        .catch((error) =>
          this.logger.warn(`Artifact retention sweep skipped: ${(error as Error).message}`),
        );
      this.leaderGeneration = generation;
    } else {
      await this.projects
        .recoverInterruptedExecutions()
        .catch((error) =>
          this.logger.warn(`Execution recovery sweep skipped: ${(error as Error).message}`),
        );
    }
    await this.projects
      .runEnvironmentExpiry()
      .catch((error) =>
        this.logger.warn(`Environment expiry sweep skipped: ${(error as Error).message}`),
      );
  }
}
