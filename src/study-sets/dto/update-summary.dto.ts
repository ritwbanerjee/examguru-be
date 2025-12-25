import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class KeyPointDto {
  @ApiProperty({
    description: 'Heading for the key point',
    example: 'Introduction'
  })
  @IsString()
  heading!: string;

  @ApiProperty({
    description: 'Detail text for the key point',
    example: 'Overview of the main concepts'
  })
  @IsString()
  detail!: string;
}

export class UpdateSummaryDto {
  @ApiProperty({
    description: 'The title of the summary',
    example: 'Chapter 1: Introduction to Biology',
    required: false
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Main summary text',
    example: 'This chapter covers the fundamental concepts of biology...',
    required: false
  })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiProperty({
    description: 'Detailed overview of the content',
    example: 'The chapter begins with an exploration of cell structure...',
    required: false
  })
  @IsString()
  @IsOptional()
  detailed_summary?: string;

  @ApiProperty({
    description: 'Array of key points with headings and details',
    type: [KeyPointDto],
    required: false
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyPointDto)
  @IsOptional()
  key_points?: KeyPointDto[];

  @ApiProperty({
    description: 'Array of study recommendations',
    type: [String],
    example: ['Review cell structure diagrams', 'Practice identifying organelles'],
    required: false
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  study_recommendations?: string[];
}
