import { Module } from '@nestjs/common';
import { ReleaseCatalogService } from './release-catalog.service';

@Module({
  providers: [ReleaseCatalogService],
  exports: [ReleaseCatalogService],
})
export class UpdatesModule {}
