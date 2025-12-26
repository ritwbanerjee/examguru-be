import { Body, Controller, Delete, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth, ApiCreatedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudySetsService } from './study-sets.service';
import { UpdateFlashcardProgressDto, UpdateFlashcardProgressResponseDto } from './dto/update-flashcard-progress.dto';
import { CreateFlashcardDto, CreateFlashcardResponseDto } from './dto/create-flashcard.dto';
import { UpdateFlashcardDto, UpdateFlashcardResponseDto } from './dto/update-flashcard.dto';

@ApiTags('Flashcards')
@ApiBearerAuth('bearer')
@Controller('flashcards')
export class FlashcardsController {
  constructor(private readonly studySetsService: StudySetsService) {}

  @Post('study-sets/:studySetId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a custom flashcard',
    description: 'Creates a new custom flashcard for a study set'
  })
  @ApiCreatedResponse({
    description: 'Flashcard created successfully',
    type: CreateFlashcardResponseDto
  })
  async createFlashcard(
    @Param('studySetId') studySetId: string,
    @Body() dto: CreateFlashcardDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<CreateFlashcardResponseDto> {
    return this.studySetsService.createFlashcard(req.user.id, studySetId, dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update a flashcard',
    description: 'Updates the content of an existing flashcard'
  })
  @ApiOkResponse({
    description: 'Flashcard updated successfully',
    type: UpdateFlashcardResponseDto
  })
  async updateFlashcard(
    @Param('id') flashcardId: string,
    @Body() dto: UpdateFlashcardDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<UpdateFlashcardResponseDto> {
    return this.studySetsService.updateFlashcard(req.user.id, flashcardId, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete a flashcard',
    description: 'Deletes a flashcard (only custom or edited flashcards can be deleted)'
  })
  @ApiOkResponse({
    description: 'Flashcard deleted successfully',
    schema: { example: { success: true, message: 'Flashcard deleted successfully' } }
  })
  async deleteFlashcard(
    @Param('id') flashcardId: string,
    @Req() req: Request & { user: { id: string } }
  ): Promise<{ success: boolean; message: string }> {
    await this.studySetsService.deleteFlashcard(req.user.id, flashcardId);
    return { success: true, message: 'Flashcard deleted successfully' };
  }

  @Patch(':id/progress')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update flashcard progress',
    description: 'Updates user progress for a specific flashcard. Tracks mastery status and answer correctness for statistics.'
  })
  @ApiOkResponse({
    description: 'Progress updated successfully',
    type: UpdateFlashcardProgressResponseDto
  })
  async updateProgress(
    @Param('id') flashcardId: string,
    @Body() dto: UpdateFlashcardProgressDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<UpdateFlashcardProgressResponseDto> {
    const result = await this.studySetsService.updateFlashcardProgress(
      req.user.id,
      flashcardId,
      dto
    );

    return {
      flashcardId: result.flashcardId,
      mastered: result.mastered,
      timesStudied: result.timesStudied,
      timesCorrect: result.timesCorrect,
      timesIncorrect: result.timesIncorrect,
      lastReviewed: result.lastReviewed.toISOString(),
      firstStudied: result.firstStudied.toISOString()
    };
  }
}
