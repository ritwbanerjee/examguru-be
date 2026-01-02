import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsageLedger, UsageLedgerDocument } from './schemas/usage-ledger.schema';
import { ProcessingJob, ProcessingJobDocument, ProcessingJobStatus } from './schemas/processing-job.schema';
import { StudySetAiJob, StudySetAiJobDocument } from '../study-sets/schemas/study-set-ai-job.schema';
import { StudySet, StudySetDocument } from '../study-sets/schemas/study-set.schema';

export interface UsageDelta {
  runsUsed?: number;
  pagesProcessed?: number;
  ocrPagesProcessed?: number;
  visionImagesProcessed?: number;
  visionUnitsProcessed?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProcessingJobInput {
  userId: Types.ObjectId;
  studySetId: Types.ObjectId;
  fileId: string;
  pages?: number;
  ocrPages?: number;
  visionImages?: number;
  visionUnits?: number;
  tokensIn?: number;
  tokensOut?: number;
  status: ProcessingJobStatus;
  statusReason?: string;
}

@Injectable()
export class UsageService {
  constructor(
    @InjectModel(UsageLedger.name)
    private readonly usageLedgerModel: Model<UsageLedgerDocument>,
    @InjectModel(ProcessingJob.name)
    private readonly processingJobModel: Model<ProcessingJobDocument>,
    @InjectModel(StudySetAiJob.name)
    private readonly aiJobModel: Model<StudySetAiJobDocument>,
    @InjectModel(StudySet.name)
    private readonly studySetModel: Model<StudySetDocument>
  ) {}

  async upsertMonthlyLedger(
    userId: Types.ObjectId,
    year: number,
    month: number,
    delta: UsageDelta
  ): Promise<UsageLedgerDocument> {
    const update: Record<string, number> = {};
    Object.entries(delta).forEach(([key, value]) => {
      if (typeof value === 'number' && value !== 0) {
        update[key] = value;
      }
    });

    return this.usageLedgerModel.findOneAndUpdate(
      { user: userId, year, month },
      {
        $setOnInsert: { user: userId, year, month },
        $inc: update
      },
      { new: true, upsert: true }
    );
  }

  async recordProcessingJob(input: ProcessingJobInput): Promise<ProcessingJobDocument> {
    return this.processingJobModel.create({
      user: input.userId,
      studySet: input.studySetId,
      fileId: input.fileId,
      pages: input.pages ?? 0,
      ocrPages: input.ocrPages ?? 0,
      visionImages: input.visionImages ?? 0,
      visionUnits: input.visionUnits ?? 0,
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
      status: input.status,
      statusReason: input.statusReason
    });
  }

  async getUserLedgers(userId: Types.ObjectId, limit = 12): Promise<UsageLedgerDocument[]> {
    return this.usageLedgerModel
      .find({ user: userId })
      .sort({ year: -1, month: -1 })
      .limit(Math.max(1, limit))
      .exec();
  }

  async getMonthlyLedger(
    userId: Types.ObjectId,
    year: number,
    month: number
  ): Promise<UsageLedgerDocument | null> {
    return this.usageLedgerModel.findOne({ user: userId, year, month }).exec();
  }

  async countActiveJobs(userId: Types.ObjectId): Promise<number> {
    return this.aiJobModel
      .countDocuments({
        user: userId,
        status: { $in: ['pending', 'processing'] }
      })
      .exec();
  }

  async countDailyRuns(userId: Types.ObjectId, now: Date): Promise<number> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return this.aiJobModel
      .countDocuments({
        user: userId,
        queuedAt: { $gte: start, $lt: end }
      })
      .exec();
  }

  async countStudySets(userId: Types.ObjectId): Promise<number> {
    return this.studySetModel.countDocuments({ user: userId }).exec();
  }
}
