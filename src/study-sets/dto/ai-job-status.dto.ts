import { ApiProperty } from '@nestjs/swagger';
import { StudySetAiJobStatus } from '../schemas/study-set-ai-job.schema';

export class AiJobStatusResponseDto {
  @ApiProperty({ example: 'f724c799-7f7a-4567-8a6c-93b0f4f8e1dc' })
  jobId!: string;

  @ApiProperty({ example: '66be58d6355bf7728390c94f' })
  studySetId!: string;

  @ApiProperty({ example: 'pending', enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: StudySetAiJobStatus;

  @ApiProperty({ example: '2024-06-11T18:33:10.000Z' })
  requestedAt!: string;

  @ApiProperty({ example: '2024-06-11T18:33:11.000Z' })
  queuedAt!: string;

  @ApiProperty({ example: '2024-06-11T18:33:12.000Z', nullable: true })
  startedAt!: string | null;

  @ApiProperty({ example: '2024-06-11T18:34:00.000Z', nullable: true })
  completedAt!: string | null;

  @ApiProperty({ example: 1 })
  attempts!: number;

  @ApiProperty({ example: 3 })
  maxAttempts!: number;

  @ApiProperty({ example: '2024-06-11T18:33:40.000Z', nullable: true })
  nextAttemptAt!: string | null;

  @ApiProperty({ example: 'Transient upstream timeout', nullable: true })
  lastError!: string | null;

  @ApiProperty({ example: 'LIMIT_PAGES_MONTHLY', nullable: true })
  lastErrorCode!: string | null;

  @ApiProperty({ nullable: true })
  lastErrorMeta!: Record<string, unknown> | null;
}
