import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkspaceMetricsQueryDto } from './dto/workspace-metrics-query.dto';
import { WorkspaceMetricsService } from './workspace-metrics.service';

describe('WorkspaceMetricsService', () => {
  const rows = [
    {
      kind: 'deploy', status: 'succeeded',
      startedAt: new Date('2026-08-01T10:00:00Z'), finishedAt: new Date('2026-08-01T10:02:00Z'),
      environment: { name: 'dev' }, buildArtifact: { createdAt: new Date('2026-08-01T09:50:00Z') },
    },
    {
      kind: 'redeploy', status: 'failed',
      startedAt: new Date('2026-08-01T11:00:00Z'), finishedAt: new Date('2026-08-01T11:01:00Z'),
      environment: { name: 'dev' }, buildArtifact: null,
    },
    {
      kind: 'rollback', status: 'succeeded',
      startedAt: new Date('2026-08-02T11:55:00Z'), finishedAt: new Date('2026-08-02T12:00:00Z'),
      environment: { name: 'prod' }, buildArtifact: { createdAt: new Date('2026-08-02T00:00:00Z') },
    },
    {
      kind: 'promote', status: 'cancelled',
      startedAt: new Date('2026-08-02T13:00:00Z'), finishedAt: new Date('2026-08-02T13:00:30Z'),
      environment: { name: 'prod' }, buildArtifact: null,
    },
  ];

  function setup(role: string | null = 'owner') {
    const findMany = jest.fn((_query: Record<string, unknown>) => 'operations');
    const audit = { record: jest.fn(async () => undefined) };
    const prisma = {
      $transaction: jest.fn(async () => [{ slug: 'platform-team' }, rows]),
      workspace: { findUnique: jest.fn(() => 'workspace') },
      deploymentOperation: { findMany },
    };
    const workspaces = {
      roleFor: jest.fn(async () => role),
      can: jest.fn((candidate: string, permission: string) =>
        ['owner', 'admin'].includes(candidate) && permission === 'admin'),
    };
    return {
      service: new WorkspaceMetricsService(prisma as never, workspaces as never, audit),
      prisma,
      findMany,
      audit,
    };
  }

  it('exports bounded UTC aggregates without selecting logs, messages, config, or identities', async () => {
    const { service, findMany, audit } = setup();
    const exported = await service.export('owner-1', 'workspace-1', {
      from: '2026-08-01', to: '2026-08-02', format: 'json',
    });

    expect(exported.filename).toBe('initpad-metrics-platform-team-2026-08-01-2026-08-02.json');
    expect(exported.data.period).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      toExclusive: '2026-08-03T00:00:00.000Z',
      timezone: 'UTC',
    });
    expect(exported.data.totals).toEqual({
      terminalDeployments: 4,
      successful: 2,
      failed: 1,
      cancelled: 1,
      successRatePercent: 66.67,
      rollbackAttempts: 1,
      successfulRollbacks: 1,
      averageTimeToHealthyDevSeconds: 120,
      averageBuildToProductionHours: 12,
    });
    expect(exported.data.daily).toHaveLength(2);
    const query = findMany.mock.calls[0][0] as {
      take: number;
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(query.take).toBe(100_001);
    expect(query.where).toMatchObject({
      environment: { project: { workspaceId: 'workspace-1' } },
      kind: { notIn: ['start', 'stop', 'remove'] },
    });
    expect(Object.keys(query.select).sort()).toEqual([
      'buildArtifact', 'environment', 'finishedAt', 'kind', 'startedAt', 'status',
    ]);
    expect(JSON.stringify(exported.data)).not.toMatch(/secret|message|actor|log/i);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace.metrics_exported',
      details: { format: 'json', from: '2026-08-01', toExclusive: '2026-08-03' },
    }));
  });

  it('creates a stable CSV with one total and daily rows', async () => {
    const { service } = setup('admin');
    const exported = await service.export('admin-1', 'workspace-1', {
      from: '2026-08-01', to: '2026-08-02', format: 'csv',
    });
    const csv = service.toCsv(exported.data);

    expect(csv.startsWith('\uFEFFscope,date,period_from')).toBe(true);
    expect(csv).toContain('total,,2026-08-01T00:00:00.000Z,2026-08-03T00:00:00.000Z,4,2,1,1,66.67,1,1,120,12');
    expect(csv.match(/\nday,/g)).toHaveLength(2);
    expect(csv).not.toMatch(/secret|message|actor|log/i);
  });

  it('returns 404 outside the workspace and 403 to a non-admin member', async () => {
    await expect(setup(null).service.export('stranger', 'workspace-1', { format: 'json' }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(setup('member').service.export('member-1', 'workspace-1', { format: 'json' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects reversed and excessively wide periods before reading operations', async () => {
    await expect(setup().service.export('owner-1', 'workspace-1', {
      from: '2026-08-03', to: '2026-08-01', format: 'json',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().service.export('owner-1', 'workspace-1', {
      from: '2025-01-01', to: '2026-08-01', format: 'json',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the date-only range emitted by the browser form', async () => {
    const dto = plainToInstance(WorkspaceMetricsQueryDto, {
      from: '2026-08-01', to: '2026-08-31', format: 'csv',
    });
    expect(await validate(dto)).toEqual([]);
  });
});
