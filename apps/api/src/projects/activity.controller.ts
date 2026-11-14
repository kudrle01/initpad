import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Cross-project activity feed (commits + CI/deploy pipeline state) for the
// signed-in user.
@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() userId: string, @Headers('x-workspace-id') workspaceId?: string) {
    return this.projects.activity(userId, workspaceId);
  }

  // `{ events, warnings }`; `?scm=true` adds cached repository commits.
  @Get('feed')
  feed(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
    @Query('scm') scm?: string,
  ) {
    return this.projects.activityFeed(userId, workspaceId, scm === 'true' || scm === '1');
  }
}
