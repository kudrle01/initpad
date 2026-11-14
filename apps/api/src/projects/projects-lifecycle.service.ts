import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ControlPlaneLeaseService } from '../common/control-plane-lease.service';
import { ProjectsService } from './projects.service';

const ENVIRONMENT_EXPIRY_SWEEP_MS = 60_000;
const PROJECTS_LEASE_TTL_MS = 3 * ENVIRONMENT_EXPIRY_SWEEP_MS;
const PROJECTS_LEASE_NAME = 'projects-lifecycle';
// Expired artifacts are released on a long-running leader too, not only when
// the lease changes hands.
const ARTIFACT_RETENTION_INTERVAL_MS = 60 * 60_000;

/** Owns leader-elected startup recovery and periodic project maintenance. */
@Injectable()
export class ProjectsLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ProjectsLifecycleService');
  private maintenanceTimer?: NodeJS.Timeout;
  private maintenance?: Promise<void>;
  private leaderGeneration?: number;
  private credentialReconciliation?: Promise<void>;
  private readonly background = new Map<string, Promise<void>>();
  private lastRetentionAt = 0;

  constructor(
    private readonly projects: ProjectsService,
    private readonly leases: ControlPlaneLeaseService,
  ) {}

  // Startup recovery runs beside module initialization. API readiness and an
  // update's health gate must never wait for work that grows with the number
  // of projects, repositories or artifacts (ADR-179).
  onModuleInit(): void {
    this.maintenanceTimer = setInterval(() => this.startLeaderCycle(), ENVIRONMENT_EXPIRY_SWEEP_MS);
    this.maintenanceTimer.unref();
    this.startLeaderCycle();
  }

  onModuleDestroy(): void {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = undefined;
  }

  private startLeaderCycle(): void {
    void this.runLeaderCycle().catch((error) =>
      this.logger.warn(`Project lifecycle lease skipped: ${(error as Error).message}`),
    );
  }

  private async runLeaderCycle(): Promise<void> {
    const claim = await this.leases.acquire(PROJECTS_LEASE_NAME, PROJECTS_LEASE_TTL_MS);
    if (!claim || this.maintenance) return;

    const becameLeader = this.leaderGeneration !== claim.generation;
    // The InitPadLeaderChurn alert counts these events (docs/OBSERVABILITY.md).
    if (becameLeader) {
      this.logger.log({
        event: 'control_plane.leader.acquired',
        lease: PROJECTS_LEASE_NAME,
        generation: claim.generation,
      });
    }
    const maintenance = this.runMaintenance(becameLeader, claim.generation);
    this.maintenance = maintenance;
    await maintenance.finally(() => {
      if (this.maintenance === maintenance) this.maintenance = undefined;
    });
  }

  private async runMaintenance(becameLeader: boolean, generation: number): Promise<void> {
    if (becameLeader) {
      // Database-only recovery. Provider work runs in the background below.
      await this.projects.reconcilePersistedState();
      this.leaderGeneration = generation;
      this.startBackground(
        'scm',
        () => this.projects.reconcileScmConfiguration(),
        'SCM reconciliation',
      );
    } else {
      await this.projects
        .recoverInterruptedExecutions()
        .catch((error) =>
          this.logger.warn(`Execution recovery sweep skipped: ${(error as Error).message}`),
        );
    }
    await this.projects
      .recoverStuckProductionApprovals()
      .catch((error) =>
        this.logger.warn(`Production approval recovery skipped: ${(error as Error).message}`),
      );
    await this.projects
      .drainPendingCiDeployments()
      .catch((error) =>
        this.logger.warn(`Queued CI deployment sweep skipped: ${(error as Error).message}`),
      );
    await this.projects
      .runEnvironmentExpiry()
      .catch((error) =>
        this.logger.warn(`Environment expiry sweep skipped: ${(error as Error).message}`),
      );
    await this.projects
      .followRenamedInstallationAccounts()
      .catch((error) =>
        this.logger.warn(`Account rename sweep skipped: ${(error as Error).message}`),
      );
    const now = Date.now();
    if (becameLeader || now - this.lastRetentionAt >= ARTIFACT_RETENTION_INTERVAL_MS) {
      if (
        this.startBackground(
          'retention',
          () => this.projects.runArtifactRetention(),
          'Artifact retention sweep',
        )
      ) {
        this.lastRetentionAt = now;
      }
    }
    this.startCredentialReconciliation();
  }

  // Single-flight background task: a slow pass is never started twice.
  private startBackground(key: string, task: () => Promise<unknown>, label: string): boolean {
    if (this.background.has(key)) return false;
    const running = task()
      .then(() => undefined)
      .catch((error) => this.logger.warn(`${label} skipped: ${(error as Error).message}`))
      .finally(() => {
        if (this.background.get(key) === running) this.background.delete(key);
      });
    this.background.set(key, running);
    return true;
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
