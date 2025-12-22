import { ApiProperty } from '@nestjs/swagger';

export class UploadStudySetFileResponseDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94a' })
  fileId!: string;

  @ApiProperty({ example: 2457600 })
  storedSizeBytes!: number;

  @ApiProperty({ example: 'study-sets/66be58d6355bf7728390c94f/files/66be58d6355bf7728390c94a.pdf' })
  storageKey!: string;

  @ApiProperty({ example: 12 })
  pageImagesStored!: number;
}
