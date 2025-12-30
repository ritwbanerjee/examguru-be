import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageLedger, UsageLedgerSchema } from './schemas/usage-ledger.schema';
import { ProcessingJob, ProcessingJobSchema } from './schemas/processing-job.schema';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageLedger.name, schema: UsageLedgerSchema },
      { name: ProcessingJob.name, schema: ProcessingJobSchema }
    ])
  ],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService]
})
export class UsageModule {}
