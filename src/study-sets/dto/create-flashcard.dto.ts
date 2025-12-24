import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class CreateFlashcardDto {
  @ApiProperty({
    description: 'The question or prompt for the flashcard',
    example: 'What is the capital of France?'
  })
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiProperty({
    description: 'The answer to the flashcard question',
    example: 'Paris'
  })
  @IsString()
  @IsNotEmpty()
  answer!: string;

  @ApiProperty({
    description: 'Additional study tip or explanation (optional)',
    example: 'Paris is located in northern France along the Seine River.',
    required: false
  })
  @IsString()
  @IsOptional()
  followUp?: string;

  @ApiProperty({
    description: 'Difficulty level of the flashcard',
    example: 'intermediate',
    enum: ['intro', 'intermediate', 'advanced'],
    required: false
  })
  @IsEnum(['intro', 'intermediate', 'advanced'])
  @IsOptional()
  difficulty?: 'intro' | 'intermediate' | 'advanced';

  @ApiProperty({
    description: 'File ID to associate the flashcard with (optional)',
    example: 'file_abc123',
    required: false
  })
  @IsString()
  @IsOptional()
  fileId?: string;
}

export class CreateFlashcardResponseDto {
  @ApiProperty({ example: 'fc_507f1f77bcf86cd799439011_file_abc123_000' })
  id!: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  studySetId!: string;

  @ApiProperty({ example: 'file_abc123' })
  fileId!: string;

  @ApiProperty({ example: 'Custom Flashcard' })
  sourceFile!: string;

  @ApiProperty({ example: 'What is the capital of France?' })
  prompt!: string;

  @ApiProperty({ example: 'Paris' })
  answer!: string;

  @ApiProperty({ example: 'Paris is located in northern France along the Seine River.' })
  followUp?: string;

  @ApiProperty({ example: 'intermediate' })
  difficulty?: string;

  @ApiProperty({ example: true })
  isEdited!: boolean;

  @ApiProperty({ example: '2025-12-24T10:00:00.000Z' })
  createdAt!: string;
}
