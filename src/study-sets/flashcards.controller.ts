import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudySetsService } from './study-sets.service';
import { UpdateFlashcardProgressDto, UpdateFlashcardProgressResponseDto } from './dto/update-flashcard-progress.dto';

@ApiTags('Flashcards')
@ApiBearerAuth('bearer')
@Controller('flashcards')
export class FlashcardsController {
  constructor(private readonly studySetsService: StudySetsService) {}

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
