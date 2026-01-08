import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStudySetDto } from './dto/create-study-set.dto';
import { StudySetsService } from './study-sets.service';
import { StudySetResponseDto } from './dto/study-set-response.dto';
import { StudySetDocument } from './schemas/study-set.schema';
import { StartAiProcessDto } from './dto/start-ai-process.dto';
import { AddStudySetFilesDto } from './dto/add-study-set-files.dto';
import { AddStudySetFilesResponseDto } from './dto/add-study-set-files-response.dto';
import { StartAiProcessResponseDto } from './dto/start-ai-process-response.dto';
import { StudySetAiFileResultsResponseDto, StudySetAiResultsResponseDto } from './dto/ai-results-response.dto';
import { StudySetAiResultStatus } from './schemas/study-set-ai-result.schema';
import { UploadStudySetFileDto } from './dto/upload-study-set-file.dto';
import { UploadStudySetFileResponseDto } from './dto/upload-study-set-file-response.dto';
import { FlashcardsResponseDto } from './dto/flashcards-response.dto';
import { UpdateSummaryDto } from './dto/update-summary.dto';
import { UpdateStudySetTitleDto } from './dto/update-study-set-title.dto';

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

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update study set title',
    description: 'Updates the title of an existing study set'
  })
  @ApiOkResponse({
    description: 'Study set title updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        title: { type: 'string' }
      }
    }
  })
  async updateTitle(
    @Param('id') studySetId: string,
    @Body() dto: UpdateStudySetTitleDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<{ success: boolean; title: string; subject: string | null }> {
    const updatedStudySet = await this.studySetsService.updateTitle(
      req.user.id,
      studySetId,
      dto.title,
      dto.subject
    );
    return { success: true, title: updatedStudySet.title, subject: updatedStudySet.subject ?? null };
  }

  @Post(':id/files')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'pageImages', maxCount: 50 }
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 100 * 1024 * 1024 }
      }
    )
  )
  @ApiOperation({
    summary: 'Upload a sliced PDF for a study set',
    description: 'Accepts a sliced PDF and stores it in Cloudflare R2 for later processing.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadStudySetFileDto })
  @ApiCreatedResponse({
    description: 'File uploaded successfully',
    type: UploadStudySetFileResponseDto
  })
  async uploadStudySetFile(
    @Param('id') studySetId: string,
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      pageImages?: Express.Multer.File[];
    },
    @Body() dto: UploadStudySetFileDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<UploadStudySetFileResponseDto> {
    const uploaded = await this.studySetsService.uploadStudySetFile(
      req.user.id,
      studySetId,
      dto,
      files?.file?.[0],
      files?.pageImages ?? []
    );
    return {
      fileId: uploaded.fileId,
      storedSizeBytes: uploaded.storedSizeBytes,
      storageKey: uploaded.storageKey,
      pageImagesStored: uploaded.pageImagesStored
    };
  }

  @Post(':id/files/prepare')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Prepare file metadata for an existing study set',
    description: 'Registers file summaries and returns file IDs so uploads can proceed.'
  })
  @ApiCreatedResponse({
    description: 'File summaries added successfully',
    type: AddStudySetFilesResponseDto
  })
  async addStudySetFiles(
    @Param('id') studySetId: string,
    @Body() dto: AddStudySetFilesDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<AddStudySetFilesResponseDto> {
    return this.studySetsService.addStudySetFiles(req.user.id, studySetId, dto.fileSummaries ?? []);
  }

  @Post(':id/ai')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Start AI processing for a study set',
    description: 'Accepts uploaded file identifiers and queues AI workloads for the specified study set.'
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

  @Get(':id/files/:fileId/ai-results')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get AI results for a specific file',
    description: 'Returns stored AI outputs (summary, flashcards, quizzes) for a single file.'
  })
  @ApiOkResponse({
    description: 'File AI results fetched successfully',
    type: StudySetAiFileResultsResponseDto
  })
  async getAiResultsForFile(
    @Param('id') studySetId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StudySetAiFileResultsResponseDto> {
    const { fileName, results } = await this.studySetsService.getResultsForStudySetFile(
      req.user.id,
      studySetId,
      fileId
    );

    return {
      studySetId,
      file: {
        fileId,
        fileName,
        features: results.map(result => ({
          feature: result.feature,
          status: result.status as StudySetAiResultStatus,
          result: result.result ?? null,
          error: result.error ?? null
        }))
      }
    };
  }

  @Patch(':id/ai-results/:fileId/summary')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update AI-generated summary',
    description: 'Updates the content of an AI-generated summary for personalization'
  })
  @ApiOkResponse({
    description: 'Summary updated successfully'
  })
  async updateSummary(
    @Param('id') studySetId: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdateSummaryDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<{ success: boolean }> {
    await this.studySetsService.updateSummary(req.user.id, studySetId, fileId, dto);
    return { success: true };
  }

  @Get(':id/flashcards')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get flashcards with user progress',
    description: 'Returns all flashcards for a study set with user\'s progress merged in. Supports filtering by mastery status, difficulty level, and source file.'
  })
  @ApiOkResponse({
    description: 'Flashcards fetched successfully',
    type: FlashcardsResponseDto
  })
  async getFlashcards(
    @Param('id') studySetId: string,
    @Query() query: { mastery?: string; difficulty?: string; fileId?: string },
    @Req() req: Request & { user: { id: string } }
  ): Promise<FlashcardsResponseDto> {
    const { mastery, difficulty, fileId } = query ?? {};
    return this.studySetsService.getFlashcardsWithProgress(
      req.user.id,
      studySetId,
      { mastery, difficulty, fileId }
    );
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
      subject: studySet.subject ?? null,
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
