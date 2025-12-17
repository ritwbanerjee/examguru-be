import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateStudySetDto } from './dto/create-study-set.dto';
import { StudySet, StudySetDocument } from './schemas/study-set.schema';
import { StartAiProcessDto } from './dto/start-ai-process.dto';
import { randomUUID } from 'crypto';
import { StudySetAiJob, StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import {
  StudySetAiResult,
  StudySetAiResultDocument,
  StudySetAiFeature,
  StudySetAiResultStatus
} from './schemas/study-set-ai-result.schema';

@Injectable()
export class StudySetsService {
  private readonly logger = new Logger(StudySetsService.name);

  constructor(
    @InjectModel(StudySet.name)
    private readonly studySetModel: Model<StudySetDocument>,
    @InjectModel(StudySetAiJob.name)
    private readonly aiJobModel: Model<StudySetAiJobDocument>,
    @InjectModel(StudySetAiResult.name)
    private readonly aiResultModel: Model<StudySetAiResultDocument>
  ) {}

  async create(userId: string, dto: CreateStudySetDto): Promise<StudySetDocument> {
    const created = new this.studySetModel({
      user: new Types.ObjectId(userId),
      title: dto.title,
      preferredLanguage: dto.preferredLanguage ?? null,
      aiFeatures: dto.aiFeatures ?? {},
      fileSummaries: dto.fileSummaries.map(summary => ({
        ...summary,
        fileId: new Types.ObjectId(),
        uploadedAt: new Date(summary.uploadedAt)
      }))
    });

    return created.save();
  }

  async findAllByUser(userId: string): Promise<StudySetDocument[]> {
    return this.studySetModel
      .find({ user: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getJobForUser(jobId: string, userId: string): Promise<StudySetAiJobDocument> {
    const job = await this.aiJobModel
      .findOne({
        jobId,
        user: new Types.ObjectId(userId)
      })
      .exec();

    if (!job) {
      throw new NotFoundException('AI job not found');
    }

    return job;
  }

  async startAiProcess(
    userId: string,
    studySetId: string,
    dto: StartAiProcessDto
  ): Promise<{ jobId: string; queuedAt: Date; studySetId: string }> {
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    const jobId = randomUUID();
    const queuedAt = new Date();

    const payload = {
      preferredLanguage: dto.preferredLanguage ?? null,
      aiFeatures: dto.aiFeatures ?? [],
      manualContent: dto.manualContent ?? null,
      files: dto.files.map(file => ({
        fileId: file.fileId,
        fileName: file.fileName,
        uploadedAt: new Date(file.uploadedAt),
        extension: file.extension,
        mimeType: file.mimeType ?? null,
        sizeBytes: file.sizeBytes,
        displaySize: file.displaySize,
        status: file.status,
        selectedRange: file.selectedRange ?? null,
        rangeSummary: file.rangeSummary ?? null,
        extractedText: file.extractedText ?? null,
        notes: file.notes ?? []
      }))
    };

    await this.aiJobModel.create({
      jobId,
      studySet: studySet._id,
      user: new Types.ObjectId(userId),
      requestedAt: new Date(dto.requestedAt),
      queuedAt,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      backoffMs: 30_000,
      nextAttemptAt: queuedAt,
      payload
    });

    this.logger.log(
      `Queued AI process ${jobId} for study set ${studySet.id} with ${dto.files.length} file(s)`
    );

    return {
      jobId,
      queuedAt,
      studySetId: studySet.id
    };
  }

  async claimNextPendingJob(now = new Date()): Promise<StudySetAiJobDocument | null> {
    const job = await this.aiJobModel
      .findOneAndUpdate(
        {
          status: 'pending',
          nextAttemptAt: { $lte: now },
          $expr: { $lt: ['$attempts', '$maxAttempts'] }
        },
        {
          $set: {
            status: 'processing',
            startedAt: now,
            nextAttemptAt: now
          },
          $inc: { attempts: 1 }
        },
        { sort: { queuedAt: 1 }, new: true }
      )
      .exec();

    return job;
  }

  async markJobCompleted(jobId: string): Promise<void> {
    await this.aiJobModel
      .updateOne(
        { jobId },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            nextAttemptAt: new Date()
          }
        }
      )
      .exec();
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    const job = await this.aiJobModel.findOne({ jobId }).exec();
    if (!job) {
      return;
    }

    const now = new Date();
    if (job.attempts >= job.maxAttempts) {
      await this.aiJobModel
        .updateOne(
          { jobId },
          {
            $set: {
              status: 'failed',
              completedAt: now,
              lastError: error
            }
          }
        )
        .exec();
      return;
    }

    const nextAttemptAt = new Date(now.getTime() + job.backoffMs);

    await this.aiJobModel
      .updateOne(
        { jobId },
        {
          $set: {
            status: 'pending',
            nextAttemptAt,
            lastError: error
          }
        }
      )
      .exec();
  }

  async retryAiJob(userId: string, jobId: string): Promise<{ jobId: string; queuedAt: Date; studySetId: string }> {
    const existing = await this.aiJobModel
      .findOne({
        jobId,
        user: new Types.ObjectId(userId)
      })
      .exec();

    if (!existing) {
      throw new NotFoundException('AI job not found');
    }

    const newJobId = randomUUID();
    const now = new Date();

    await this.aiJobModel.create({
      jobId: newJobId,
      studySet: existing.studySet,
      user: existing.user,
      requestedAt: now,
      queuedAt: now,
      status: 'pending',
      attempts: 0,
      maxAttempts: existing.maxAttempts,
      backoffMs: existing.backoffMs,
      nextAttemptAt: now,
      payload: existing.payload
    });

    const fileIds = (existing.payload?.files ?? []).map((file: any) => file.fileId);
    const features = existing.payload?.aiFeatures ?? [];
    if (fileIds.length && features.length) {
      await this.aiResultModel
        .updateMany(
          {
            studySet: existing.studySet,
            fileId: { $in: fileIds },
            feature: { $in: features }
          },
          {
            $set: {
              status: 'pending',
              result: null,
              error: null
            }
          }
        )
        .exec();
    }

    return {
      jobId: newJobId,
      queuedAt: now,
      studySetId: existing.studySet.toString()
    };
  }

  async upsertAiResult(params: {
    job: StudySetAiJobDocument;
    fileId: string;
    fileName: string;
    feature: StudySetAiFeature;
    status: StudySetAiResultStatus;
    result?: unknown | null;
    error?: string | null;
  }): Promise<void> {
    await this.aiResultModel
      .findOneAndUpdate(
        {
          job: params.job._id,
          fileId: params.fileId,
          feature: params.feature
        },
        {
          $set: {
            studySet: params.job.studySet,
            fileName: params.fileName,
            status: params.status,
            result: params.result ?? null,
            error: params.error ?? null
          }
        },
        { upsert: true }
      )
      .exec();
  }

  async getResultsForStudySet(userId: string, studySetId: string): Promise<StudySetAiResultDocument[]> {
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    return this.aiResultModel
      .find({ studySet: studySet._id })
      .sort({ fileId: 1, feature: 1 })
      .exec();
  }
}
