import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudySetsService } from './study-sets.service';
import { StudySetsController } from './study-sets.controller';
import { FlashcardsController } from './flashcards.controller';
import { StudySessionsController } from './study-sessions.controller';
import { StudySet, StudySetSchema } from './schemas/study-set.schema';
import { StudySetAiJob, StudySetAiJobSchema } from './schemas/study-set-ai-job.schema';
import { AiJobsController } from './ai-jobs.controller';
import { AiJobsProcessorService } from './ai-jobs.processor';
import { StudySetAiResult, StudySetAiResultSchema } from './schemas/study-set-ai-result.schema';
import { SummariesModule } from '../summaries/summaries.module';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { R2StorageService } from '../storage/r2-storage.service';
import { DocumentProcessingService } from './document-processing.service';
import { UsersModule } from '../users/users.module';
import { PlansModule } from '../plans/plans.module';
import { UsageModule } from '../usage/usage.module';

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
    UsersModule,
    PlansModule,
    UsageModule
  ],
  controllers: [StudySetsController, AiJobsController, FlashcardsController, StudySessionsController],
  providers: [StudySetsService, AiJobsProcessorService, R2StorageService, DocumentProcessingService]
})
export class StudySetsModule {}
