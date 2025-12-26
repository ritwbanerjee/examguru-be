import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsArray, Min } from 'class-validator';

export class CreateStudySessionDto {
  @ApiProperty({
    description: 'Study set ID',
    example: '507f1f77bcf86cd799439011'
  })
  @IsNotEmpty()
  @IsString()
  studySetId!: string;

  @ApiProperty({
    description: 'Filter type for flashcards',
    enum: ['all', 'unmastered', 'mastered'],
    example: 'unmastered'
  })
  @IsEnum(['all', 'unmastered', 'mastered'])
  filterType!: 'all' | 'unmastered' | 'mastered';
}

export class UpdateStudySessionDto {
  @ApiProperty({
    description: 'Session duration in seconds',
    example: 300,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  duration?: number;

  @ApiProperty({
    description: 'Number of cards studied in this session',
    example: 15,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cardsStudied?: number;

  @ApiProperty({
    description: 'Number of cards marked as mastered',
    example: 10,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cardsMastered?: number;

  @ApiProperty({
    description: 'Number of cards needing review',
    example: 5,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cardsNeedingReview?: number;

  @ApiProperty({
    description: 'Array of flashcard IDs studied in this session',
    example: ['fc_507f1f77bcf86cd799439011_file_abc123_000'],
    required: false,
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flashcardIds?: string[];
}

export class StudySessionResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439012' })
  sessionId!: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  studySetId!: string;

  @ApiProperty({ example: 'unmastered', enum: ['all', 'unmastered', 'mastered'] })
  filterType!: string;

  @ApiProperty({ example: '2025-12-23T10:00:00.000Z' })
  startedAt!: string;

  @ApiProperty({ example: '2025-12-23T10:15:00.000Z', nullable: true })
  completedAt!: string | null;

  @ApiProperty({ example: 900 })
  duration!: number;

  @ApiProperty({ example: 15 })
  cardsStudied!: number;

  @ApiProperty({ example: 10 })
  cardsMastered!: number;

  @ApiProperty({ example: 5 })
  cardsNeedingReview!: number;

  @ApiProperty({ example: ['fc_507f1f77bcf86cd799439011_file_abc123_000'], type: [String] })
  flashcardIds!: string[];
}
