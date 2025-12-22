import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UploadStudySetFileDto {
  @ApiProperty({ example: '66be58d6355bf7728390c94a' })
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsNumber()
  rangeStart!: number;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  rangeEnd!: number;

  @ApiPropertyOptional({ example: 'Pages 1–10', nullable: true })
  @IsOptional()
  @IsString()
  rangeSummary?: string | null;
}
