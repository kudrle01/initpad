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
  private credentialReconciliation?: Promise<void>;

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
    this.startCredentialReconciliation();
  }

  // Moving an existing installation to scoped Gitea credentials costs several
  // Gitea requests per account and repository (ADR-134). It runs beside the
  // maintenance cycle so it can never delay API readiness, an update's health
  // gate or the expiry sweep, and a new pass starts only after the last ends.
  private startCredentialReconciliation(): void {
    if (this.credentialReconciliation) return;
    const reconciliation = this.projects
      .reconcileGiteaCredentials()
      .catch((error) =>
        this.logger.warn(`Gitea credential reconciliation skipped: ${(error as Error).message}`),
      )
      .finally(() => {
        if (this.credentialReconciliation === reconciliation) {
          this.credentialReconciliation = undefined;
        }
      });
    this.credentialReconciliation = reconciliation;
  }
}
