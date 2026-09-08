import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEventsService } from '../audit/audit-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceMetricsQueryDto } from './dto/workspace-metrics-query.dto';
import { WorkspacesService } from './workspaces.service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;
const MAX_OPERATIONS = 100_000;
const NON_DEPLOYMENT_KINDS = ['start', 'stop', 'remove'];

type OperationRow = {
  kind: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  environment: { name: string };
  buildArtifact: { createdAt: Date } | null;
};

type Aggregate = {
  terminalDeployments: number;
  successful: number;
  failed: number;
  cancelled: number;
  successRatePercent: number | null;
  rollbackAttempts: number;
  successfulRollbacks: number;
  averageTimeToHealthyDevSeconds: number | null;
  averageBuildToProductionHours: number | null;
};

export type WorkspaceMetricsExport = {
  schemaVersion: 1;
  period: { from: string; toExclusive: string; timezone: 'UTC' };
  definitions: {
    successRate: string;
    timeToHealthyDev: string;
    buildToProduction: string;
  };
  totals: Aggregate;
  daily: Array<Aggregate & { date: string }>;
};

@Injectable()
export class WorkspaceMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: async () => undefined,
    },
  ) {}

  async export(
    userId: string,
    workspaceId: string,
    query: WorkspaceMetricsQueryDto,
    now = new Date(),
  ): Promise<{ data: WorkspaceMetricsExport; filename: string }> {
    const role = await this.workspaces.roleFor(userId, workspaceId);
    if (!role) throw new NotFoundException('Workspace not found');
    if (!this.workspaces.can(role, 'admin')) {
      throw new ForbiddenException('Workspace admin access required');
    }

    const range = this.parseRange(query, now);
    const [workspace, operations] = await this.prisma.$transaction([
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { slug: true },
      }),
      this.prisma.deploymentOperation.findMany({
        where: {
          environment: { project: { workspaceId } },
          finishedAt: { gte: range.from, lt: range.to },
          kind: { notIn: NON_DEPLOYMENT_KINDS },
        },
        orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
        take: MAX_OPERATIONS + 1,
        select: {
          kind: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          environment: { select: { name: true } },
          buildArtifact: { select: { createdAt: true } },
        },
      }),
    ]);
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (operations.length > MAX_OPERATIONS) {
      throw new BadRequestException('This period contains too many operations; choose a shorter range');
    }

    const rows = operations as OperationRow[];
    const byDay = new Map<string, OperationRow[]>();
    for (const operation of rows) {
      if (!operation.finishedAt) continue;
      const day = operation.finishedAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? [];
      bucket.push(operation);
      byDay.set(day, bucket);
    }
    const daily = [...byDay.entries()].map(([date, dayRows]) => ({
      date,
      ...this.aggregate(dayRows),
    }));
    const data: WorkspaceMetricsExport = {
      schemaVersion: 1,
      period: {
        from: range.from.toISOString(),
        toExclusive: range.to.toISOString(),
        timezone: 'UTC',
      },
      definitions: {
        successRate: 'Successful / (successful + failed) deployment operations; cancelled operations are excluded.',
        timeToHealthyDev: 'Average request-to-success duration for successful dev deployments.',
        buildToProduction: 'Average time from verified build record creation to successful production deployment.',
      },
      totals: this.aggregate(rows),
      daily,
    };

    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.metrics_exported',
      resourceType: 'workspace',
      resourceId: workspaceId,
      resourceName: workspace.slug,
      details: {
        format: query.format,
        from: data.period.from.slice(0, 10),
        toExclusive: data.period.toExclusive.slice(0, 10),
      },
    });

    const from = data.period.from.slice(0, 10);
    const through = new Date(range.to.getTime() - 1).toISOString().slice(0, 10);
    return {
      data,
      filename: `initpad-metrics-${workspace.slug}-${from}-${through}.${query.format}`,
    };
  }

  toCsv(exported: WorkspaceMetricsExport): string {
    const header = [
      'scope',
      'date',
      'period_from',
      'period_to_exclusive',
      'terminal_deployments',
      'successful',
      'failed',
      'cancelled',
      'success_rate_percent',
      'rollback_attempts',
      'successful_rollbacks',
      'average_time_to_healthy_dev_seconds',
      'average_build_to_production_hours',
    ];
    const row = (scope: 'total' | 'day', date: string, values: Aggregate) => [
      scope,
      date,
      exported.period.from,
      exported.period.toExclusive,
      values.terminalDeployments,
      values.successful,
      values.failed,
      values.cancelled,
      values.successRatePercent ?? '',
      values.rollbackAttempts,
      values.successfulRollbacks,
      values.averageTimeToHealthyDevSeconds ?? '',
      values.averageBuildToProductionHours ?? '',
    ].map(this.csvCell).join(',');

    return `\uFEFF${[
      header.join(','),
      row('total', '', exported.totals),
      ...exported.daily.map((day) => row('day', day.date, day)),
    ].join('\n')}\n`;
  }

  private parseRange(query: WorkspaceMetricsQueryDto, now: Date): { from: Date; to: Date } {
    const to = query.to ? this.parseBound(query.to, true) : now;
    const from = query.from
      ? this.parseBound(query.from, false)
      : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new BadRequestException('Metrics period contains an invalid date');
    }
    if (from >= to) throw new BadRequestException('Metrics period must end after it starts');
    if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
      throw new BadRequestException(`Metrics period cannot exceed ${MAX_PERIOD_DAYS} days`);
    }
    return { from, to };
  }

  private parseBound(value: string, inclusiveDateEnd: boolean): Date {
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
    if (inclusiveDateEnd && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(parsed.getTime() + DAY_MS);
    }
    return parsed;
  }

  private aggregate(rows: OperationRow[]): Aggregate {
    const successful = rows.filter((row) => row.status === 'succeeded');
    const failed = rows.filter((row) => row.status === 'failed');
    const cancelled = rows.filter((row) => row.status === 'cancelled');
    const completed = successful.length + failed.length;
    const devDurations = successful
      .filter((row) => row.environment.name === 'dev' && row.finishedAt)
      .map((row) => Math.max(0, row.finishedAt!.getTime() - row.startedAt.getTime()) / 1_000);
    const productionLeadTimes = successful
      .filter((row) => row.environment.name === 'prod' && row.finishedAt && row.buildArtifact)
      .map((row) => (row.finishedAt!.getTime() - row.buildArtifact!.createdAt.getTime()) / (60 * 60 * 1_000))
      .filter((hours) => hours >= 0);
    return {
      terminalDeployments: rows.length,
      successful: successful.length,
      failed: failed.length,
      cancelled: cancelled.length,
      successRatePercent: completed ? this.round(successful.length / completed * 100) : null,
      rollbackAttempts: rows.filter((row) => row.kind === 'rollback').length,
      successfulRollbacks: successful.filter((row) => row.kind === 'rollback').length,
      averageTimeToHealthyDevSeconds: this.average(devDurations),
      averageBuildToProductionHours: this.average(productionLeadTimes),
    };
  }

  private average(values: number[]): number | null {
    return values.length ? this.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private csvCell(value: string | number): string {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
