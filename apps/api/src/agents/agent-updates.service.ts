import { Injectable } from '@nestjs/common';
import { ReleaseCatalogService } from '../updates/release-catalog.service';
import { compareStableVersions, parseStableVersion } from '../updates/release-manifest';
import { AgentsService } from './agents.service';
import { agentVersionAtLeast, MIN_REMOTE_UPDATE_AGENT_VERSION } from './agent-version';

export interface AgentUpdateStatus {
  enabled: boolean;
  checkedAt: string | null;
  stale: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateMethod: 'none' | 'manual' | 'remote';
  image: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  error: string | null;
}

@Injectable()
export class AgentUpdatesService {
  constructor(
    private readonly agents: AgentsService,
    private readonly catalog: ReleaseCatalogService,
  ) {}

  async status(targetId: string, userId: string): Promise<AgentUpdateStatus> {
    await this.agents.requireTargetAccess(targetId, userId, 'admin');
    const [agent, catalog] = await Promise.all([
      this.agents.getForTarget(targetId, userId),
      this.catalog.latestAgentRelease(),
    ]);
    const currentVersion = agent?.version ?? null;
    const latestVersion = catalog.release?.manifest.version ?? null;
    const updateAvailable = Boolean(
      currentVersion &&
      latestVersion &&
      parseStableVersion(currentVersion) &&
      compareStableVersions(latestVersion, currentVersion) > 0,
    );
    return {
      enabled: catalog.enabled,
      checkedAt: catalog.checkedAt,
      stale: catalog.stale,
      currentVersion,
      latestVersion,
      updateAvailable,
      updateMethod: !updateAvailable
        ? 'none'
        : agentVersionAtLeast(currentVersion, MIN_REMOTE_UPDATE_AGENT_VERSION)
          ? 'remote'
          : 'manual',
      image: catalog.release?.manifest.image.immutableReference ?? null,
      releaseUrl: catalog.release?.releaseUrl ?? null,
      publishedAt: catalog.release?.publishedAt ?? null,
      error: catalog.error,
    };
  }
}
