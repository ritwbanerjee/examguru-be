import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChaptersService } from './chapters.service';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { ChapterResponseDto } from './dto/chapter-response.dto';

@Controller('chapters')
@UseGuards(JwtAuthGuard)
export class ChaptersController {
  constructor(private readonly chaptersService: ChaptersService) {}

  /**
   * Create a new chapter
   * POST /chapters
   */
  @Post()
  async create(
    @Req() req: any,
    @Body() createChapterDto: CreateChapterDto,
  ): Promise<ChapterResponseDto> {
    const userId = req.user.id;
    return this.chaptersService.create(userId, createChapterDto);
  }

  /**
   * Get all chapters for current user
   * GET /chapters
   */
  @Get()
  async findAll(@Req() req: any): Promise<ChapterResponseDto[]> {
    const userId = req.user.id;
    return this.chaptersService.findAll(userId);
  }

  /**
   * Update (rename) a chapter
   * PATCH /chapters/:id
   */
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateChapterDto: UpdateChapterDto,
  ): Promise<ChapterResponseDto> {
    const userId = req.user.id;
    return this.chaptersService.update(id, userId, updateChapterDto);
  }

  /**
   * Delete a chapter
   * DELETE /chapters/:id
   * Note: This unassigns all study sets from the chapter
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: any, @Param('id') id: string): Promise<void> {
    const userId = req.user.id;
    await this.chaptersService.remove(id, userId);
  }
}
