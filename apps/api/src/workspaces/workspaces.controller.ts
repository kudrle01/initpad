import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateWorkspaceDto,
  UpdateProductionApprovalPolicyDto,
  UpdateWorkspaceDto,
} from './dto/create-workspace.dto';
import { AddWorkspaceMemberDto, UpdateWorkspaceMemberDto } from './dto/member.dto';
import { WorkspacesService } from './workspaces.service';
import { WorkspacePortfolioService } from './workspace-portfolio.service';
import { WorkspaceMetricsService } from './workspace-metrics.service';
import { WorkspaceMetricsQueryDto } from './dto/workspace-metrics-query.dto';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly portfolio: WorkspacePortfolioService,
    private readonly metrics: WorkspaceMetricsService,
  ) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.workspaces.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(userId, dto);
  }

  @Get(':id/portfolio')
  portfolioSummary(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.portfolio.get(userId, id);
  }

  @Get(':id/metrics')
  async exportMetrics(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Query() query: WorkspaceMetricsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const exported = await this.metrics.export(userId, id, query);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    if (query.format === 'csv') {
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return this.metrics.toCsv(exported.data);
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    return exported.data;
  }

  @Put(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(userId, id, dto);
  }

  @Put(':id/production-approval-policy')
  updateProductionApprovalPolicy(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductionApprovalPolicyDto,
  ) {
    return this.workspaces.updateProductionApprovalPolicy(userId, id, dto.policy);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.workspaces.remove(userId, id);
  }

  @Get(':id/members')
  members(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.workspaces.members(userId, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: AddWorkspaceMemberDto,
  ) {
    return this.workspaces.addMember(userId, id, dto);
  }

  @Put(':id/members/:memberId')
  updateMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateWorkspaceMemberDto,
  ) {
    return this.workspaces.updateMember(userId, id, memberId, dto);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.workspaces.removeMember(userId, id, memberId);
  }
}
