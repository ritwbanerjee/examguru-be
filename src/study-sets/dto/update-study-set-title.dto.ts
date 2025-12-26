import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
}
