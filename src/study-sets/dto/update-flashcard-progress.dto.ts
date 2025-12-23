import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateFlashcardProgressDto {
  @ApiProperty({
    description: 'Whether the user marked this flashcard as mastered',
    example: true,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  mastered?: boolean;

  @ApiProperty({
    description: 'Whether the user answered correctly (for statistics tracking)',
    example: true,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  answeredCorrectly?: boolean;
}

export class UpdateFlashcardProgressResponseDto {
  @ApiProperty({ example: 'fc_507f1f77bcf86cd799439011_file_abc123_000' })
  flashcardId!: string;

  @ApiProperty({ example: false })
  mastered!: boolean;

  @ApiProperty({ example: 5 })
  timesStudied!: number;

  @ApiProperty({ example: 3 })
  timesCorrect!: number;

  @ApiProperty({ example: 2 })
  timesIncorrect!: number;

  @ApiProperty({ example: '2025-12-23T10:30:00.000Z' })
  lastReviewed!: string;

  @ApiProperty({ example: '2025-12-20T14:15:00.000Z' })
  firstStudied!: string;
}
