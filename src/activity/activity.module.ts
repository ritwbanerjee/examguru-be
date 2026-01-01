import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';
import { StudyActivityDaily, StudyActivityDailySchema } from './schemas/study-activity-daily.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ActivityLog.name,
        schema: ActivityLogSchema
      },
      {
        name: StudyActivityDaily.name,
        schema: StudyActivityDailySchema
      }
    ])
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService]
})
export class ActivityModule {}
