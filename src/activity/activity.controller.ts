import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivityService } from './activity.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ActivityResponseDto } from './dto/activity-response.dto';
import { StudyTimeDto } from './dto/study-time.dto';

@ApiTags('Activity')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'Get recent activity for the current user' })
  @ApiOkResponse({ type: [ActivityResponseDto] })
  async getRecent(
    @Req() req: Request & { user: { id: string } },
    @Query('limit') limit?: string
  ): Promise<ActivityResponseDto[]> {
    const parsed = Number(limit);
    return this.activityService.getRecentActivity(req.user.id, Number.isFinite(parsed) ? parsed : 6);
  }

  @Post()
  @ApiOperation({ summary: 'Record an activity item for the current user' })
  @ApiOkResponse({ type: ActivityResponseDto })
  async create(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: CreateActivityDto
  ): Promise<ActivityResponseDto | null> {
    return this.activityService.createActivity(req.user.id, dto);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get dashboard metrics for the current user' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        quizAttempts: { type: 'number' },
        quizPasses: { type: 'number' },
        streakDays: { type: 'number' }
      }
    }
  })
  async getMetrics(
    @Req() req: Request & { user: { id: string } }
  ): Promise<{ quizAttempts: number; quizPasses: number; streakDays: number }> {
    return this.activityService.getMetrics(req.user.id);
  }

  @Post('study-time')
  @ApiOperation({ summary: 'Record study time for the current user' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' }
      }
    }
  })
  async recordStudyTime(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: StudyTimeDto
  ): Promise<{ success: boolean }> {
    await this.activityService.recordStudyMinutes({
      userId: req.user.id,
      studySetId: dto.studySetId,
      studySetTitle: dto.studySetTitle,
      minutes: dto.minutes ?? 1
    });
    return { success: true };
  }
}
