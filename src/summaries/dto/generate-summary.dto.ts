import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateSummaryDto {
  @ApiProperty({
    description: 'Cleaned study material text that should be summarized',
    example: 'Photosynthesis is the process that...'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150000, {
    message: 'Content must be fewer than 150,000 characters to protect the LLM from overload.'
  })
  content!: string;

  @ApiProperty({
    description: 'Optional topic or title for better summaries',
    required: false,
    example: 'Biology - Photosynthesis'
  })
  @IsString()
  @MaxLength(180)
  topic?: string;
}
