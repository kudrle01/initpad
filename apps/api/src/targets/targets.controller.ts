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
import { TargetsService } from './targets.service';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Deployment targets: the built-in simulated infrastructure plus the servers
// the user registers themselves. Every operation is scoped to the signed-in
// user (built-ins are read-only and shared).
@Controller('targets')
@UseGuards(JwtAuthGuard)
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get()
  list(@CurrentUser() userId: string, @Headers('x-workspace-id') workspaceId?: string) {
    return this.targets.listForUser(userId, workspaceId);
  }

  @Post()
  create(
    @Body() dto: CreateTargetDto,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.targets.create(userId, dto, workspaceId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTargetDto, @CurrentUser() userId: string) {
    return this.targets.update(id, userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.targets.remove(id, userId);
  }

  @Post(':id/disconnect')
  @HttpCode(204)
  disconnect(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.targets.disconnect(id, userId);
  }

  @Post(':id/retire')
  @HttpCode(204)
  retire(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.targets.retire(id, userId);
  }

  @Post(':id/restore')
  @HttpCode(204)
  restore(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.targets.restore(id, userId);
  }

  // Live connection test ("Test connection"). Stamps the target as verified.
  @Post(':id/verify')
  verify(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.targets.verify(id, userId, workspaceId);
  }
}
