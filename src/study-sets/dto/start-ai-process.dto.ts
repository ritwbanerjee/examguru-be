import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
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

  @ApiProperty({ type: [String], example: ['66be58d6355bf7728390c94a'] })
  @IsArray()
  @IsString({ each: true })
  fileIds!: string[];
}
