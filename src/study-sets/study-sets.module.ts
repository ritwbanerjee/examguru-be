import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudySetsService } from './study-sets.service';
import { StudySetsController } from './study-sets.controller';
import { StudySet, StudySetSchema } from './schemas/study-set.schema';
import { StudySetAiJob, StudySetAiJobSchema } from './schemas/study-set-ai-job.schema';
import { AiJobsController } from './ai-jobs.controller';
import { AiJobsProcessorService } from './ai-jobs.processor';
import { StudySetAiResult, StudySetAiResultSchema } from './schemas/study-set-ai-result.schema';
import { SummariesModule } from '../summaries/summaries.module';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: StudySet.name,
        schema: StudySetSchema
      },
      {
        name: StudySetAiJob.name,
        schema: StudySetAiJobSchema
      },
      {
        name: StudySetAiResult.name,
        schema: StudySetAiResultSchema
      }
    ]),
    SummariesModule,
    FlashcardsModule,
    QuizzesModule,
    AIModule
  ],
  controllers: [StudySetsController, AiJobsController],
  providers: [StudySetsService, AiJobsProcessorService]
})
export class StudySetsModule {}
