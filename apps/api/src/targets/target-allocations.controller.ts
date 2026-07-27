import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TargetAllocationsService } from './target-allocations.service';
import { CreateTargetAllocationDto } from './dto/create-target-allocation.dto';
import { UpdateTargetAllocationDto } from './dto/update-target-allocation.dto';

// Workspace-scoped allocations of physical targets (ADR-060). Owner/admin manage;
// any member reads. Allocations in other workspaces are invisible (404).
@Controller('allocations')
@UseGuards(JwtAuthGuard)
export class TargetAllocationsController {
  constructor(private readonly allocations: TargetAllocationsService) {}

  @Get()
  list(@CurrentUser() userId: string, @Headers('x-workspace-id') workspaceId?: string) {
    return this.allocations.list(userId, workspaceId);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.allocations.get(id, userId);
  }

  @Post()
  create(
    @Body() dto: CreateTargetAllocationDto,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.allocations.create(userId, dto, workspaceId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTargetAllocationDto,
    @CurrentUser() userId: string,
  ) {
    return this.allocations.update(id, userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.allocations.remove(id, userId);
  }
}
