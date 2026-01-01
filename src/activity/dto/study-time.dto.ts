import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class StudyTimeDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsString()
  studySetId!: string;

  @ApiProperty({ required: false, example: 'Cloud Computing Notes' })
  @IsOptional()
  @IsString()
  studySetTitle?: string;

  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  minutes?: number;
}
