import { Module } from '@nestjs/common';
import { SummariesService } from './summaries.service';
import { SummariesController } from './summaries.controller';

@Module({
  controllers: [SummariesController],
  providers: [SummariesService]
})
export class SummariesModule {}
