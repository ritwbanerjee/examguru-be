import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityLog, ActivityLogDocument } from './schemas/activity-log.schema';
import { StudyActivityDaily, StudyActivityDailyDocument } from './schemas/study-activity-daily.schema';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ActivityResponseDto } from './dto/activity-response.dto';

@Injectable()
export class ActivityService {
  constructor(
    @InjectModel(ActivityLog.name)
    private readonly activityModel: Model<ActivityLogDocument>,
    @InjectModel(StudyActivityDaily.name)
    private readonly studyActivityModel: Model<StudyActivityDailyDocument>
  ) {}

  async createActivity(userId: string, dto: CreateActivityDto): Promise<ActivityResponseDto | null> {
    const payload: Partial<ActivityLog> = {
      user: new Types.ObjectId(userId),
      type: dto.type,
      label: dto.label,
      detail: dto.detail,
      icon: dto.icon,
      studySet: dto.studySetId ? new Types.ObjectId(dto.studySetId) : undefined,
      fileId: dto.fileId,
      activityKey: dto.activityKey,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : undefined,
      meta: dto.meta
    };

    try {
      const doc = await this.activityModel.create(payload);
      return this.toResponse(doc);
    } catch (error: any) {
      if (error?.code === 11000) {
        return null;
      }
      throw error;
    }
  }

  async getRecentActivity(userId: string, limit = 6): Promise<ActivityResponseDto[]> {
    const items = await this.activityModel
      .find({ user: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, limit))
      .lean();

    return items.map(item =>
      this.toResponse({
        ...item,
        _id: item._id
      } as ActivityLogDocument)
    );
  }

  async recordStudyMinutes(params: {
    userId: string;
    studySetId: string;
    studySetTitle?: string;
    minutes: number;
  }): Promise<void> {
    const dateKey = new Date().toISOString().slice(0, 10);
    const user = new Types.ObjectId(params.userId);
    const studySet = new Types.ObjectId(params.studySetId);
    const minutes = Math.max(1, Math.round(params.minutes));

    const existing = await this.studyActivityModel
      .findOne({ user, studySet, dateKey })
      .lean();
    const previousMinutes = existing?.minutes ?? 0;
    const nextMinutes = previousMinutes + minutes;

    await this.studyActivityModel.updateOne(
      { user, studySet, dateKey },
      {
        $inc: { minutes },
        $set: { lastActiveAt: new Date() },
        $setOnInsert: { user, studySet, dateKey }
      },
      { upsert: true }
    );

    if (previousMinutes < 30 && nextMinutes >= 30) {
      await this.createActivity(params.userId, {
        type: 'study_streak',
        label: 'Study streak earned',
        detail: `${params.studySetTitle ?? 'Study set'} · 30+ minutes`,
        icon: 'local_fire_department',
        studySetId: params.studySetId,
        activityKey: `streak:${params.studySetId}:${dateKey}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  async getMetrics(userId: string): Promise<{
    quizAttempts: number;
    quizPasses: number;
    streakDays: number;
  }> {
    const user = new Types.ObjectId(userId);
    const quizAttempts = await this.activityModel.countDocuments({
      user,
      type: 'quiz_completed'
    });
    const quizPasses = await this.activityModel.countDocuments({
      user,
      type: 'quiz_completed',
      'meta.passed': true
    });

    const dailyTotals = await this.studyActivityModel.aggregate<{ _id: string; minutes: number }>([
      { $match: { user } },
      { $group: { _id: '$dateKey', minutes: { $sum: '$minutes' } } }
    ]);

    const totalsByDate = new Map(dailyTotals.map(item => [item._id, item.minutes]));
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    while (true) {
      const key = cursor.toISOString().slice(0, 10);
      const minutes = totalsByDate.get(key) ?? 0;
      if (minutes < 30) {
        break;
      }
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      if (streak >= 365) {
        break;
      }
    }

    return {
      quizAttempts,
      quizPasses,
      streakDays: streak
    };
  }

  async getQuizStatsByStudySet(
    userId: string,
    studySetIds: string[]
  ): Promise<Map<string, { attempts: number; averageScore: number | null }>> {
    if (!studySetIds.length) {
      return new Map();
    }

    const user = new Types.ObjectId(userId);
    const studySetObjectIds = studySetIds.map(id => new Types.ObjectId(id));

    const stats = await this.activityModel.aggregate<{
      _id: Types.ObjectId;
      attempts: number;
      averageScore: number | null;
    }>([
      {
        $match: {
          user,
          type: 'quiz_completed',
          studySet: { $in: studySetObjectIds }
        }
      },
      {
        $addFields: {
          scoreValue: { $ifNull: ['$meta.score', null] }
        }
      },
      {
        $group: {
          _id: '$studySet',
          attempts: { $sum: 1 },
          averageScore: { $avg: '$scoreValue' }
        }
      }
    ]);

    return new Map(
      stats.map(item => [
        item._id.toString(),
        {
          attempts: item.attempts ?? 0,
          averageScore: typeof item.averageScore === 'number' ? item.averageScore : null
        }
      ])
    );
  }

  private toResponse(doc: ActivityLogDocument): ActivityResponseDto {
    const timestamp = doc.timestamp ?? (doc as { createdAt?: Date }).createdAt ?? new Date();
    return {
      id: doc._id.toString(),
      icon: doc.icon ?? 'info',
      label: doc.label,
      detail: doc.detail,
      timestamp: timestamp.toISOString(),
      type: doc.type,
      studySetId: doc.studySet?.toString(),
      fileId: doc.fileId
    };
  }
}
