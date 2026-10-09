import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { PlatformUpdatesService } from '../updates/platform-updates.service';
import { RequestPlatformUpdateDto } from '../updates/dto/request-platform-update.dto';
import { UpdateWorkspaceCapacityDto } from './dto/update-workspace-capacity.dto';
import { builtInAppsShareSessionCookie } from '../config';

// Platform administration API. Account provisioning and self-update are used
// by self-hosted installations; workspace capacity policy also protects SaaS.
// Every route requires a valid session AND the platform administrator role.
@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly platformUpdates: PlatformUpdatesService,
  ) {}

  @Get('updates')
  updateStatus() {
    return this.platformUpdates.status();
  }

  @Post('updates')
  installUpdate(@CurrentUser() userId: string, @Body() dto: RequestPlatformUpdateDto) {
    return this.platformUpdates.request(userId, dto.requestId);
  }

  @Get('security')
  securityStatus() {
    return { builtInAppsShareSession: builtInAppsShareSessionCookie() };
  }

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Get('workspaces/capacity')
  listWorkspaceCapacity() {
    return this.admin.listWorkspaceCapacity();
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
  createUser(@Body() dto: CreateUserDto) {
    return this.admin.createUser(dto);
  }

  @Post('users/:id/deactivate')
  deactivate(@CurrentUser() actingUserId: string, @Param('id') id: string) {
    return this.admin.setActive(actingUserId, id, false);
  }

  @Post('users/:id/activate')
  activate(@CurrentUser() actingUserId: string, @Param('id') id: string) {
    return this.admin.setActive(actingUserId, id, true);
  }

  @Post('users/:id/reset-password')
  resetPassword(@Param('id') id: string) {
    return this.admin.resetPassword(id);
  }

  @Post('users/:id/activation-link')
  createActivationLink(@Param('id') id: string) {
    return this.admin.createActivationLink(id);
  }
}
