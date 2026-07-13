import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AddCourseMemberDto,
  CreateCourseDto,
  CreateCourseTeamDto,
  JoinCourseDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { CoursesService } from './courses.service';

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.courses.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateCourseDto) {
    return this.courses.create(userId, dto);
  }

  @Post('join')
  join(@CurrentUser() userId: string, @Body() dto: JoinCourseDto) {
    return this.courses.join(userId, dto.enrollmentCode);
  }

  @Get(':id')
  detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.courses.detail(userId, id);
  }

  @Put(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.courses.update(userId, id, dto);
  }

  @Post(':id/enrollment-code')
  rotateCode(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.courses.rotateEnrollmentCode(userId, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: AddCourseMemberDto,
  ) {
    return this.courses.addMember(userId, id, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.courses.removeMember(userId, id, memberId);
  }

  @Post(':id/teams')
  createTeam(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCourseTeamDto,
  ) {
    return this.courses.createTeam(userId, id, dto);
  }

  @Post(':id/teams/:teamId/join')
  joinTeam(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
  ) {
    return this.courses.joinTeam(userId, id, teamId);
  }

  @Delete(':id/teams/:teamId/members/:memberId')
  @HttpCode(200)
  removeTeamMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.courses.removeTeamMember(userId, id, teamId, memberId);
  }
}
