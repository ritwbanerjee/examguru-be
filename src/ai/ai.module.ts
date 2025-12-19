import { Module } from '@nestjs/common';
import { CombinedAIService } from './combined-ai.service';
import { SummariesModule } from '../summaries/summaries.module';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { QuizzesModule } from '../quizzes/quizzes.module';

@Module({
  imports: [SummariesModule, FlashcardsModule, QuizzesModule],
  providers: [CombinedAIService],
  exports: [CombinedAIService]
})
export class AIModule {}
