import { Body, Controller, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudySetsService } from './study-sets.service';
import { CreateStudySessionDto, UpdateStudySessionDto, StudySessionResponseDto } from './dto/study-session.dto';

@ApiTags('Study Sessions')
@ApiBearerAuth('bearer')
@Controller('study-sessions')
export class StudySessionsController {
  constructor(private readonly studySetsService: StudySetsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a new study session',
    description: 'Starts a new study session for a specific study set with the selected filter type (all, unmastered, or mastered flashcards).'
  })
  @ApiCreatedResponse({
    description: 'Study session created successfully',
    type: StudySessionResponseDto
  })
  async createSession(
    @Body() dto: CreateStudySessionDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StudySessionResponseDto> {
    const result = await this.studySetsService.createStudySession(
      req.user.id,
      dto.studySetId,
      dto.filterType
    );

    return {
      sessionId: result.sessionId,
      studySetId: result.studySetId,
      filterType: result.filterType,
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt ? result.completedAt.toISOString() : null,
      duration: result.duration,
      cardsStudied: result.cardsStudied,
      cardsMastered: result.cardsMastered,
      cardsNeedingReview: result.cardsNeedingReview,
      flashcardIds: result.flashcardIds
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update study session progress',
    description: 'Updates a study session with progress metrics such as duration, cards studied, and mastery statistics.'
  })
  @ApiOkResponse({
    description: 'Study session updated successfully',
    type: StudySessionResponseDto
  })
  async updateSession(
    @Param('id') sessionId: string,
    @Body() dto: UpdateStudySessionDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StudySessionResponseDto> {
    const result = await this.studySetsService.updateStudySession(
      req.user.id,
      sessionId,
      dto
    );

    return {
      sessionId: result.sessionId,
      studySetId: result.studySetId,
      filterType: result.filterType,
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt ? result.completedAt.toISOString() : null,
      duration: result.duration,
      cardsStudied: result.cardsStudied,
      cardsMastered: result.cardsMastered,
      cardsNeedingReview: result.cardsNeedingReview,
      flashcardIds: result.flashcardIds
    };
  }
}
