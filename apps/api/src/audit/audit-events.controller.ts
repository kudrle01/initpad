import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditEventsService } from './audit-events.service';
import { ListAuditEventsDto } from './dto/list-audit-events.dto';

@Controller('audit-events')
@UseGuards(JwtAuthGuard)
export class AuditEventsController {
  constructor(private readonly auditEvents: AuditEventsService) {}

  @Get()
  list(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Query() query: ListAuditEventsDto,
  ) {
    return this.auditEvents.list(userId, workspaceId, query);
  }
}
