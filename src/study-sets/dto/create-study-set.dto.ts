import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class FileSummaryDto {
  @ApiProperty({
    description: 'Original name of the uploaded file',
    example: 'chapter6.pdf'
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'ISO timestamp indicating when the user uploaded the file',
    example: '2024-06-11T18:31:00.000Z'
  })
  @IsISO8601()
  uploadedAt!: string;

  @ApiProperty({
    description: 'File extension used to infer type',
    example: 'pdf'
  })
  @IsString()
  @IsNotEmpty()
  extension!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 2457600
  })
  @IsNumber()
  sizeBytes!: number;

  @ApiProperty({
    description: 'Human readable file size',
    example: '2.3 MB'
  })
  @IsString()
  @IsNotEmpty()
  displaySize!: string;
}

export class CreateStudySetDto {
  @ApiProperty({
    description: 'Display title for the study set',
    example: 'Biology Chapter 6'
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Preferred language to use for AI responses',
    example: 'en-US',
    required: false,
    nullable: true
  })
  @IsOptional()
  @IsString()
  preferredLanguage?: string | null;

  @ApiProperty({
    description: 'Map of AI feature toggles selected by the user',
    example: {
      summary: true,
      flashcards: false,
      quizzes: true
    }
  })
  @IsObject()
  aiFeatures!: Record<string, boolean>;

  @ApiProperty({
    description: 'List of uploaded file summaries required to create the study set',
    type: [FileSummaryDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileSummaryDto)
  fileSummaries!: FileSummaryDto[];
}
