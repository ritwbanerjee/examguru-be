import { ApiProperty } from '@nestjs/swagger';
import { StudySetAiResultStatus } from '../schemas/study-set-ai-result.schema';

class AiFeatureResultDto {
  @ApiProperty({ example: 'summary' })
  feature!: string;

  @ApiProperty({ example: 'completed', enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: StudySetAiResultStatus;

  @ApiProperty({
    example: {
      summary: 'Photosynthesis converts light energy...',
      key_points: [{ heading: 'Overview', detail: '...' }]
    },
    nullable: true
  })
  result!: unknown | null;

  @ApiProperty({ example: 'Upstream AI timeout', nullable: true })
  error!: string | null;
}

class AiFileResultDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94a' })
  fileId!: string;

  @ApiProperty({ example: 'chapter6.pdf' })
  fileName!: string;

  @ApiProperty({ type: [AiFeatureResultDto] })
  features!: AiFeatureResultDto[];
}

export class StudySetAiResultsResponseDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94f' })
  studySetId!: string;

  @ApiProperty({ type: [AiFileResultDto] })
  files!: AiFileResultDto[];
}

export class StudySetAiFileResultsResponseDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94f' })
  studySetId!: string;

  @ApiProperty({ type: AiFileResultDto })
  file!: AiFileResultDto;
}
