import { IsOptional, IsString } from 'class-validator';

export class AssignChapterDto {
  @IsOptional()
  @IsString()
  chapterId!: string | null;
}
