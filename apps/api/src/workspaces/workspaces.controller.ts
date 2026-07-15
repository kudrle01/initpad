import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';
import { AddWorkspaceMemberDto, UpdateWorkspaceMemberDto } from './dto/member.dto';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.workspaces.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(userId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(userId, id, dto);
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
