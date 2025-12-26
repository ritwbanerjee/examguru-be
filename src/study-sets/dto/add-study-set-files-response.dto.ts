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

export class AddStudySetFilesResponseDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94f' })
  studySetId!: string;

  @ApiProperty({ type: [FileSummaryResponseDto] })
  fileSummaries!: FileSummaryResponseDto[];
}
