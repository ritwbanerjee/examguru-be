import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageLedger, UsageLedgerSchema } from './schemas/usage-ledger.schema';
import { ProcessingJob, ProcessingJobSchema } from './schemas/processing-job.schema';
import { StudySetAiJob, StudySetAiJobSchema } from '../study-sets/schemas/study-set-ai-job.schema';
import { StudySet, StudySetSchema } from '../study-sets/schemas/study-set.schema';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { UsersModule } from '../users/users.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageLedger.name, schema: UsageLedgerSchema },
      { name: ProcessingJob.name, schema: ProcessingJobSchema },
      { name: StudySetAiJob.name, schema: StudySetAiJobSchema },
      { name: StudySet.name, schema: StudySetSchema }
    ]),
    UsersModule,
    PlansModule
  ],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService]
})
export class UsageModule {}
