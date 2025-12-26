import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';
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

export class AddStudySetFilesDto {
  @ApiProperty({
    description: 'Files to add to an existing study set before upload',
    type: [FileSummaryDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileSummaryDto)
  fileSummaries!: FileSummaryDto[];
}
