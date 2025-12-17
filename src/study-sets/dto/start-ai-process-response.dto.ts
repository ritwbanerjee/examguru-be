import { ApiProperty } from '@nestjs/swagger';

export class StartAiProcessResponseDto {
  @ApiProperty({ example: '66be58d6-355b-4772-8390-c94f9a2b3c10' })
  jobId!: string;

  @ApiProperty({ example: '66be58d6355bf7728390c94f' })
  studySetId!: string;

  @ApiProperty({ example: 'pending', enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: 'pending' | 'processing' | 'completed' | 'failed';

  @ApiProperty({ example: '2024-06-11T18:33:10.000Z' })
  queuedAt!: string;
}
