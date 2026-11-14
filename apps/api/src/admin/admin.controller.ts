import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePlatformRoleDto } from './dto/update-platform-role.dto';
import { ListWorkspaceCapacityDto } from './dto/list-workspace-capacity.dto';
import { PlatformUpdatesService } from '../updates/platform-updates.service';
import { RequestPlatformUpdateDto } from '../updates/dto/request-platform-update.dto';
import { UpdateWorkspaceCapacityDto } from './dto/update-workspace-capacity.dto';
import { builtInAppsShareSessionCookie } from '../config';
import { AuditEventsService } from '../audit/audit-events.service';
import { ListAuditEventsDto } from '../audit/dto/list-audit-events.dto';

// Instance administration API of the self-hosted edition: PlatformAdminGuard
// refuses every route in SaaS, which enforces the configured default capacity
// limits without an instance administrator. Every route requires a valid
// session AND the platform administrator role.
@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly platformUpdates: PlatformUpdatesService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  @Get('updates')
  updateStatus(@Query('refresh') refresh?: string) {
    return this.platformUpdates.status(refresh === '1');
  }

  @Post('updates')
  installUpdate(@CurrentUser() userId: string, @Body() dto: RequestPlatformUpdateDto) {
    return this.platformUpdates.request(userId, dto.requestId);
  }

  @Get('security')
  securityStatus() {
    return { builtInAppsShareSession: builtInAppsShareSessionCookie() };
  }

  // Sign-in, account administration and events of deleted workspaces (ADR-142).
  @Get('audit-events')
  listAuditEvents(@Query() query: ListAuditEventsDto) {
    return this.auditEvents.listPlatform(query);
  }

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Get('workspaces/capacity')
  listWorkspaceCapacity(@Query() query: ListWorkspaceCapacityDto) {
    return this.admin.listWorkspaceCapacity({ limit: query.limit, offset: query.offset });
  }

  @Put('workspaces/:id/capacity')
  updateWorkspaceCapacity(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceCapacityDto,
  ) {
    return this.admin.updateWorkspaceCapacity(userId, id, dto);
  }

  @Post('users')
  createUser(@CurrentUser() actingUserId: string, @Body() dto: CreateUserDto) {
    return this.admin.createUser(actingUserId, dto);
  }

  @Post('users/:id/deactivate')
  deactivate(@CurrentUser() actingUserId: string, @Param('id') id: string) {
    return this.admin.setActive(actingUserId, id, false);
  }

  @Post('users/:id/activate')
  activate(@CurrentUser() actingUserId: string, @Param('id') id: string) {
    return this.admin.setActive(actingUserId, id, true);
  }

  @Put('users/:id/platform-role')
  setPlatformRole(
    @CurrentUser() actingUserId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformRoleDto,
  ) {
    return this.admin.setPlatformRole(actingUserId, id, dto.platformRole);
  }

  @Post('users/:id/reset-password')
  resetPassword(@CurrentUser() actingUserId: string, @Param('id') id: string) {
    return this.admin.resetPassword(actingUserId, id);
  }

  @Post('users/:id/activation-link')
  createActivationLink(@CurrentUser() actingUserId: string, @Param('id') id: string) {
    return this.admin.createActivationLink(actingUserId, id);
  }
}
