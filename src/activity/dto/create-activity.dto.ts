import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateActivityDto {
  @ApiProperty({ example: 'quiz_completed' })
  @IsString()
  type!: string;

  @ApiProperty({ example: 'Completed quiz' })
  @IsString()
  label!: string;

  @ApiProperty({ example: 'Cloud Computing · Score 85%' })
  @IsString()
  detail!: string;

  @ApiProperty({ required: false, example: 'quiz' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ required: false, example: '507f1f77bcf86cd799439011' })
  @IsOptional()
  @IsString()
  studySetId?: string;

  @ApiProperty({ required: false, example: 'file_abc123' })
  @IsOptional()
  @IsString()
  fileId?: string;

  @ApiProperty({ required: false, example: 'quiz:507f1f77bcf86cd799439011:quiz_001' })
  @IsOptional()
  @IsString()
  activityKey?: string;

  @ApiProperty({ required: false, example: '2025-12-30T20:00:00.000Z' })
  @IsOptional()
  @IsString()
  timestamp?: string;

  @ApiProperty({ required: false, example: { passed: true, score: 85, quizId: 'quiz_001' } })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
