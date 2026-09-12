import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const ENVIRONMENT_EXPIRY_SWEEP_MS = 60_000;

/** Owns API-process startup recovery and periodic project maintenance. */
@Injectable()
export class ProjectsLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ProjectsLifecycleService');
  private expiryTimer?: NodeJS.Timeout;
  private expirySweep?: Promise<void>;

  constructor(private readonly projects: ProjectsService) {}

  async onModuleInit(): Promise<void> {
    await this.projects.reconcilePersistedState();
    await this.projects
      .runArtifactRetention()
      .catch((error) =>
        this.logger.warn(`Artifact retention sweep skipped: ${(error as Error).message}`),
      );
    await this.runEnvironmentExpiry();
    this.expiryTimer = setInterval(
      () => void this.runEnvironmentExpiry(),
      ENVIRONMENT_EXPIRY_SWEEP_MS,
    );
    this.expiryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  private async runEnvironmentExpiry(): Promise<void> {
    if (this.expirySweep) return this.expirySweep;
    const sweep = this.projects
      .runEnvironmentExpiry()
      .then(() => undefined)
      .catch((error) =>
        this.logger.warn(`Environment expiry sweep skipped: ${(error as Error).message}`),
      );
    this.expirySweep = sweep;
    await sweep.finally(() => {
      if (this.expirySweep === sweep) this.expirySweep = undefined;
    });
  }
}
