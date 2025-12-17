import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudySetsService } from './study-sets.service';
import { AiJobStatusResponseDto } from './dto/ai-job-status.dto';
import { StartAiProcessResponseDto } from './dto/start-ai-process-response.dto';

@ApiTags('AI Jobs')
@ApiBearerAuth('bearer')
@Controller('ai-jobs')
export class AiJobsController {
  constructor(private readonly studySetsService: StudySetsService) {}

  @Get(':jobId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get AI job status',
    description: 'Returns the processing status of an AI job created for a study set.'
  })
  @ApiOkResponse({
    description: 'AI job status retrieved successfully',
    type: AiJobStatusResponseDto
  })
  async getStatus(
    @Param('jobId') jobId: string,
    @Req() req: Request & { user: { id: string } }
  ): Promise<AiJobStatusResponseDto> {
    const job = await this.studySetsService.getJobForUser(jobId, req.user.id);
    return {
      jobId: job.jobId,
      studySetId: job.studySet.toString(),
      status: job.status,
      requestedAt: job.requestedAt.toISOString(),
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: job.nextAttemptAt ? job.nextAttemptAt.toISOString() : null,
      lastError: job.lastError ?? null
    };
  }

  @Post(':jobId/retry')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Retry a failed AI job',
    description: 'Re-queues the AI processing pipeline using the original payload.'
  })
  @ApiAcceptedResponse({
    description: 'AI job successfully re-queued',
    type: StartAiProcessResponseDto
  })
  async retryJob(
    @Param('jobId') jobId: string,
    @Req() req: Request & { user: { id: string } }
  ): Promise<StartAiProcessResponseDto> {
    const job = await this.studySetsService.retryAiJob(req.user.id, jobId);
    return {
      jobId: job.jobId,
      studySetId: job.studySetId,
      status: 'pending',
      queuedAt: job.queuedAt.toISOString()
    };
  }
}
