import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString
} from 'class-validator';

export class StartAiProcessDto {
  @ApiProperty({ example: '2024-06-11T18:33:10.000Z' })
  @IsISO8601()
  requestedAt!: string;

  @ApiPropertyOptional({ example: 'en-US', nullable: true })
  @IsOptional()
  @IsString()
  preferredLanguage?: string | null;

  @ApiProperty({
    type: [String],
    example: ['summary', 'flashcards'],
    enum: ['summary', 'flashcards', 'quizzes']
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one AI feature must be selected' })
  @IsString({ each: true })
  @IsIn(['summary', 'flashcards', 'quizzes'], {
    each: true,
    message: 'Invalid AI feature. Must be one of: summary, flashcards, quizzes'
  })
  aiFeatures!: string[];

  @ApiPropertyOptional({
    description: 'Optional manual content entered by the user',
    example: 'Custom notes provided by the learner.',
    nullable: true
  })
  @IsOptional()
  @IsString()
  manualContent?: string | null;

  @ApiProperty({ type: [String], example: ['66be58d6355bf7728390c94a'] })
  @IsArray()
  @ArrayMinSize(1, { message: 'fileIds are required to start processing.' })
  @IsString({ each: true })
  fileIds!: string[];
}
