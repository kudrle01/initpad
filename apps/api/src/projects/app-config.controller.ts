import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppConfigService } from './app-config.service';
import { UpsertConfigVarDto } from './dto/upsert-config-var.dto';

// Per-environment application config & secrets (ADR-061). Project-write manages;
// any member reads (secret values are always masked).
@Controller('projects/:id/environments/:env/config')
@UseGuards(JwtAuthGuard)
export class AppConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  list(
    @Param('id') id: string,
    @Param('env') env: string,
    @CurrentUser() userId: string,
  ) {
    return this.config.list(userId, id, env);
  }

  @Put(':key')
  upsert(
    @Param('id') id: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @Body() dto: UpsertConfigVarDto,
    @CurrentUser() userId: string,
  ) {
    return this.config.upsert(userId, id, env, key, dto);
  }

  @Delete(':key')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @Param('env') env: string,
    @Param('key') key: string,
    @CurrentUser() userId: string,
  ) {
    return this.config.remove(userId, id, env, key);
  }
}
