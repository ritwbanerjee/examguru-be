import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStudySetDto } from './dto/create-study-set.dto';
import { StudySetsService } from './study-sets.service';
import { StudySetResponseDto } from './dto/study-set-response.dto';
import { StudySetDocument } from './schemas/study-set.schema';
import { StartAiProcessDto } from './dto/start-ai-process.dto';
import { StartAiProcessResponseDto } from './dto/start-ai-process-response.dto';
import { StudySetAiResultsResponseDto } from './dto/ai-results-response.dto';
import { StudySetAiResultStatus } from './schemas/study-set-ai-result.schema';

@ApiTags('Study Sets')
@ApiBearerAuth('bearer')
@Controller('study-sets')
export class StudySetsController {
  constructor(private readonly studySetsService: StudySetsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a study set',
    description: 'Creates a new study set for the authenticated user using uploaded file metadata and AI feature selections.'
  })
  @ApiCreatedResponse({
    description: 'Study set successfully created',
    type: StudySetResponseDto
  })
  async create(
    @Body() dto: CreateStudySetDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StudySetResponseDto> {
    const studySet = await this.studySetsService.create(req.user.id, dto);
    return this.mapToResponseDto(studySet);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List study sets for the current user',
    description: 'Returns all study sets created by the authenticated user ordered by most recent first.'
  })
  @ApiOkResponse({
    description: 'List of study sets fetched successfully',
    type: [StudySetResponseDto]
  })
  async findAll(
    @Req() req: Request & { user: { id: string } }
  ): Promise<StudySetResponseDto[]> {
    const studySets = await this.studySetsService.findAllByUser(req.user.id);
    return studySets.map(set => this.mapToResponseDto(set));
  }

  @Post(':id/ai')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Start AI processing for a study set',
    description: 'Accepts extracted file content and queues AI workloads for the specified study set.'
  })
  @ApiAcceptedResponse({
    description: 'AI request accepted and queued for processing',
    type: StartAiProcessResponseDto
  })
  async startAiProcess(
    @Param('id') studySetId: string,
    @Body() dto: StartAiProcessDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StartAiProcessResponseDto> {
    const job = await this.studySetsService.startAiProcess(req.user.id, studySetId, dto);
    return {
      jobId: job.jobId,
      studySetId: job.studySetId,
      status: 'pending',
      queuedAt: job.queuedAt.toISOString()
    };
  }

  @Get(':id/ai-results')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get AI results for a study set',
    description: 'Returns stored AI outputs (summaries, flashcards, quizzes) grouped per file.'
  })
  @ApiOkResponse({
    description: 'AI results fetched successfully',
    type: StudySetAiResultsResponseDto
  })
  async getAiResults(
    @Param('id') studySetId: string,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StudySetAiResultsResponseDto> {
    const results = await this.studySetsService.getResultsForStudySet(req.user.id, studySetId);
    const files = new Map<
      string,
      {
        fileId: string;
        fileName: string;
        features: Array<{
          feature: string;
          status: StudySetAiResultStatus;
          result: unknown | null;
          error: string | null;
        }>;
      }
    >();

    for (const result of results) {
      const key = `${result.fileId}:${result.fileName}`;
      if (!files.has(key)) {
        files.set(key, {
          fileId: result.fileId,
          fileName: result.fileName,
          features: []
        });
      }

      files.get(key)!.features.push({
        feature: result.feature,
        status: result.status as StudySetAiResultStatus,
        result: result.result ?? null,
        error: result.error ?? null
      });
    }

    return {
      studySetId,
      files: Array.from(files.values())
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete a study set',
    description: 'Removes the study set along with queued jobs and AI results for the authenticated user.'
  })
  @ApiOkResponse({ description: 'Study set deleted successfully' })
  async deleteStudySet(
    @Param('id') studySetId: string,
    @Req() req: Request & { user: { id: string } }
  ): Promise<{ deleted: true }> {
    await this.studySetsService.deleteStudySet(req.user.id, studySetId);
    return { deleted: true };
  }

  private mapToResponseDto(studySet: StudySetDocument): StudySetResponseDto {
    return {
      studySetId: studySet.id,
      title: studySet.title,
      preferredLanguage: studySet.preferredLanguage ?? null,
      aiFeatures: studySet.aiFeatures ?? {},
      fileSummaries: (studySet.fileSummaries ?? []).map(summary => ({
        fileId: summary.fileId?.toString() ?? '',
        fileName: summary.fileName,
        uploadedAt: summary.uploadedAt instanceof Date
          ? summary.uploadedAt.toISOString()
          : new Date(summary.uploadedAt).toISOString(),
        extension: summary.extension,
        sizeBytes: summary.sizeBytes,
        displaySize: summary.displaySize
      })),
      createdAt: studySet.createdAt ?? new Date()
    };
  }
}
