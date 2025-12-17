import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsIn
} from 'class-validator';
import { Type } from 'class-transformer';

const FILE_STATUSES = ['queued', 'analyzing', 'awaiting-range', 'extracting', 'completed', 'error'] as const;

class SelectedRangeDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  start!: number;

  @ApiProperty({ example: 5 })
  @IsNumber()
  end!: number;
}

class StartAiProcessFileDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94a' })
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @ApiProperty({ example: 'chapter6.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({ example: '2024-06-11T18:31:00.000Z' })
  @IsISO8601()
  uploadedAt!: string;

  @ApiProperty({ example: 'pdf' })
  @IsString()
  @IsNotEmpty()
  extension!: string;

  @ApiPropertyOptional({ example: 'application/pdf', nullable: true })
  @IsOptional()
  @IsString()
  mimeType?: string | null;

  @ApiProperty({ example: 2457600 })
  @IsNumber()
  sizeBytes!: number;

  @ApiProperty({ example: '2.3 MB' })
  @IsString()
  displaySize!: string;

  @ApiProperty({ enum: FILE_STATUSES, example: 'completed' })
  @IsIn(FILE_STATUSES)
  status!: (typeof FILE_STATUSES)[number];

  @ApiPropertyOptional({ type: SelectedRangeDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => SelectedRangeDto)
  selectedRange?: SelectedRangeDto | null;

  @ApiPropertyOptional({ example: 'Pages 1–3', nullable: true })
  @IsOptional()
  @IsString()
  rangeSummary?: string | null;

  @ApiPropertyOptional({ example: 'Detected text content', nullable: true })
  @IsOptional()
  @IsString()
  extractedText?: string | null;

  @ApiProperty({ type: [String], example: ['OCR detected scanned pages'] })
  @IsArray()
  @IsString({ each: true })
  notes!: string[];
}

export class StartAiProcessDto {
  @ApiProperty({ example: '2024-06-11T18:33:10.000Z' })
  @IsISO8601()
  requestedAt!: string;

  @ApiPropertyOptional({ example: 'en-US', nullable: true })
  @IsOptional()
  @IsString()
  preferredLanguage?: string | null;

  @ApiProperty({ type: [String], example: ['summary', 'flashcards'] })
  @IsArray()
  @IsString({ each: true })
  aiFeatures!: string[];

  @ApiPropertyOptional({
    description: 'Optional manual content entered by the user',
    example: 'Custom notes provided by the learner.',
    nullable: true
  })
  @IsOptional()
  @IsString()
  manualContent?: string | null;

  @ApiProperty({ type: [StartAiProcessFileDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StartAiProcessFileDto)
  files!: StartAiProcessFileDto[];
}
