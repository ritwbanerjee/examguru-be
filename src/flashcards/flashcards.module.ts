import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlashcardsService } from './flashcards.service';
import { FlashcardProgress, FlashcardProgressSchema } from './schemas/flashcard-progress.schema';
import { StudySession, StudySessionSchema } from './schemas/study-session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlashcardProgress.name, schema: FlashcardProgressSchema },
      { name: StudySession.name, schema: StudySessionSchema }
    ])
  ],
  providers: [FlashcardsService],
  exports: [FlashcardsService, MongooseModule]
})
export class FlashcardsModule {}
