import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { decryptSecret, encryptSecret } from '../common/secret';

// Environment-variable name convention; reserved keys are managed by the
// platform runtime contract and cannot be overridden by users.
const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_KEYS = new Set(['PORT']);
const MAX_VALUE_LENGTH = 8192;

export interface ConfigVarSummary {
  key: string;
  isSecret: boolean;
  // Plaintext for non-secrets; null for secrets (never returned in the clear).
  value: string | null;
  hasValue: boolean;
  updatedAt: string;
}

/**
 * Per-environment application config & secrets (ADR-061). Non-secret values are
 * stored and returned in clear; secret values are encrypted at rest and masked
 * in every API response. Managed by a project-write member; applied to the app
 * only at deploy time (see configVarsForDeploy).
 */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(userId: string, projectId: string, envName: string): Promise<ConfigVarSummary[]> {
    await this.workspaces.requireProject(userId, projectId, 'read');
    const environmentId = await this.environmentId(projectId, envName);
    const rows = await this.prisma.appConfigVar.findMany({
      where: { environmentId },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async upsert(
    userId: string,
    projectId: string,
    envName: string,
    key: string,
    dto: { value: string; isSecret?: boolean },
  ): Promise<ConfigVarSummary> {
    await this.workspaces.requireProject(userId, projectId, 'write');
    const normalizedKey = (key ?? '').trim();
    if (!KEY_RE.test(normalizedKey)) {
      throw new BadRequestException(
        'Key must match ^[A-Z_][A-Z0-9_]* (uppercase letters, digits and underscore)',
      );
    }
    if (RESERVED_KEYS.has(normalizedKey)) {
      throw new BadRequestException(`'${normalizedKey}' is a reserved platform variable`);
    }
    if (typeof dto.value !== 'string' || dto.value.length > MAX_VALUE_LENGTH) {
      throw new BadRequestException(`Value must be a string up to ${MAX_VALUE_LENGTH} characters`);
    }
    const environmentId = await this.environmentId(projectId, envName);
    const isSecret = dto.isSecret === true;
    const stored = isSecret ? encryptSecret(dto.value) : dto.value;
    const row = await this.prisma.appConfigVar.upsert({
      where: { environmentId_key: { environmentId, key: normalizedKey } },
      create: { environmentId, key: normalizedKey, value: stored, isSecret },
      update: { value: stored, isSecret },
    });
    return this.toSummary(row);
  }

  async remove(userId: string, projectId: string, envName: string, key: string): Promise<void> {
    await this.workspaces.requireProject(userId, projectId, 'write');
    const environmentId = await this.environmentId(projectId, envName);
    await this.prisma.appConfigVar.deleteMany({ where: { environmentId, key } });
  }

  // Decrypted KEY=VALUE map for injecting into a deployment (ADR-061 §3). Secrets
  // are decrypted only here, in memory, at deploy time. Internal use only.
  async configVarsForDeploy(environmentId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.appConfigVar.findMany({ where: { environmentId } });
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.isSecret ? decryptSecret(row.value) : row.value;
    }
    return map;
  }

  private async environmentId(projectId: string, envName: string): Promise<string> {
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
      select: { id: true },
    });
    if (!env) throw new NotFoundException(`Environment '${envName}' not found`);
    return env.id;
  }

  private toSummary(row: {
    key: string;
    value: string;
    isSecret: boolean;
    updatedAt: Date;
  }): ConfigVarSummary {
    return {
      key: row.key,
      isSecret: row.isSecret,
      value: row.isSecret ? null : row.value,
      hasValue: row.value.length > 0,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
