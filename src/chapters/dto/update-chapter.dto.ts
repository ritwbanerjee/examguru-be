import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class UpdateChapterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;
}
