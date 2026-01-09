import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateChapterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;
}
