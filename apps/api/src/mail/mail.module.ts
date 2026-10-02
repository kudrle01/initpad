import { Module } from '@nestjs/common';
import { MailDeliveryService } from './mail-delivery.service';

@Module({
  providers: [MailDeliveryService],
  exports: [MailDeliveryService],
})
export class MailModule {}
