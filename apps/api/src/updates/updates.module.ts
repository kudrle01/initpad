import { Module } from '@nestjs/common';
import { ReleaseCatalogService } from './release-catalog.service';
import { PlatformReleaseCatalogService } from './platform-release-catalog.service';
import { PlatformUpdatesService } from './platform-updates.service';
import { SupervisorClientService } from './supervisor-client.service';

@Module({
  providers: [
    ReleaseCatalogService,
    PlatformReleaseCatalogService,
    PlatformUpdatesService,
    SupervisorClientService,
  ],
  exports: [ReleaseCatalogService, PlatformUpdatesService],
})
export class UpdatesModule {}
