import { ApiProperty } from '@nestjs/swagger';

class FileSummaryResponseDto {
  @ApiProperty({ example: 'file-abc123' })
  fileId!: string;

  @ApiProperty({ example: 'chapter6.pdf' })
  fileName!: string;

  @ApiProperty({ example: '2024-06-11T18:31:00.000Z' })
  uploadedAt!: string;

  @ApiProperty({ example: 'pdf' })
  extension!: string;

  @ApiProperty({ example: 2457600 })
  sizeBytes!: number;

  @ApiProperty({ example: '2.3 MB' })
  displaySize!: string;
}

export class StudySetResponseDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94f' })
  studySetId!: string;

  @ApiProperty({ example: 'Biology Chapter 6' })
  title!: string;

  @ApiProperty({ example: 'Biology', nullable: true })
  subject!: string | null;

  @ApiProperty({ example: 'en-US', nullable: true })
  preferredLanguage!: string | null;

  @ApiProperty({
    example: {
      summary: true,
      flashcards: false,
      quizzes: true
    }
  })
  aiFeatures!: Record<string, boolean>;

  @ApiProperty({ type: [FileSummaryResponseDto] })
  fileSummaries!: FileSummaryResponseDto[];

  @ApiProperty({ example: '66be58d6355bf7728390c94f', nullable: true })
  chapterId!: string | null;

  @ApiProperty({ example: '2024-06-11T18:33:00.000Z' })
  createdAt!: Date;
}
