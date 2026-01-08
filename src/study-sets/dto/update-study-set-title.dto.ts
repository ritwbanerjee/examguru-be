import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateStudySetTitleDto {
  @ApiProperty({
    description: 'New title for the study set',
    example: 'My Updated Study Set',
    minLength: 1,
    maxLength: 200
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    description: 'Updated subject for the study set',
    example: 'Biology',
    required: false,
    maxLength: 30
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^(?=.*\p{L})[\p{L} ]+$/u)
  subject?: string;
}
