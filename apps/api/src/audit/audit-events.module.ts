import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditEventsController],
  providers: [AuditEventsService],
  exports: [AuditEventsService],
})
export class AuditEventsModule {}
