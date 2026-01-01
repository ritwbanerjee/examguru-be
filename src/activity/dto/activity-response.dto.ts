import { ApiProperty } from '@nestjs/swagger';

export class ActivityResponseDto {
  @ApiProperty({ example: '64f2d1b2c9e4b9c1e7b4a123' })
  id!: string;

  @ApiProperty({ example: 'quiz' })
  icon!: string;

  @ApiProperty({ example: 'Completed quiz' })
  label!: string;

  @ApiProperty({ example: 'Cloud Computing · Score 85%' })
  detail!: string;

  @ApiProperty({ example: '2025-12-30T20:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ required: false, example: 'quiz_completed' })
  type?: string;

  @ApiProperty({ required: false, example: '507f1f77bcf86cd799439011' })
  studySetId?: string;

  @ApiProperty({ required: false, example: 'file_abc123' })
  fileId?: string;
}
