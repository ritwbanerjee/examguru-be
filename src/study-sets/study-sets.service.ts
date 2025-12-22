import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Express } from 'express';
import { PDFDocument } from 'pdf-lib';
import { CreateStudySetDto } from './dto/create-study-set.dto';
import { StudySet, StudySetDocument } from './schemas/study-set.schema';
import { StartAiProcessDto } from './dto/start-ai-process.dto';
import { randomUUID } from 'crypto';
import { AiProcessFileSnapshot, StudySetAiJob, StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import {
  StudySetAiResult,
  StudySetAiResultDocument,
  StudySetAiFeature,
  StudySetAiResultStatus
} from './schemas/study-set-ai-result.schema';
import { R2StorageService } from '../storage/r2-storage.service';

@Injectable()
export class StudySetsService {
  private readonly logger = new Logger(StudySetsService.name);

  constructor(
    @InjectModel(StudySet.name)
    private readonly studySetModel: Model<StudySetDocument>,
    @InjectModel(StudySetAiJob.name)
    private readonly aiJobModel: Model<StudySetAiJobDocument>,
    @InjectModel(StudySetAiResult.name)
    private readonly aiResultModel: Model<StudySetAiResultDocument>,
    private readonly storage: R2StorageService
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

  async uploadStudySetFile(
    userId: string,
    studySetId: string,
    params: {
      fileId: string;
      rangeStart: number;
      rangeEnd: number;
      rangeSummary?: string | null;
    },
    file?: Express.Multer.File,
    pageImages: Express.Multer.File[] = []
  ): Promise<{ fileId: string; storageKey: string; storedSizeBytes: number; pageImagesStored: number }> {
    if (!file?.buffer) {
      throw new BadRequestException('File upload is required.');
    }

    if (!params.fileId) {
      throw new BadRequestException('fileId is required.');
    }

    if (!Number.isFinite(params.rangeStart) || !Number.isFinite(params.rangeEnd)) {
      throw new BadRequestException('rangeStart and rangeEnd are required.');
    }

    if (params.rangeStart > params.rangeEnd) {
      throw new BadRequestException('rangeStart must be less than rangeEnd.');
    }

    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    const summary = studySet.fileSummaries.find(
      item => item.fileId?.toString() === params.fileId
    );

    if (!summary) {
      throw new NotFoundException('File not found for this study set');
    }

    if (summary.extension !== 'pdf') {
      throw new BadRequestException('Only PDF uploads are supported.');
    }
    if (!file.mimetype || !file.mimetype.includes('pdf')) {
      throw new BadRequestException('Uploaded file must be a PDF.');
    }

    const slicedBuffer = await this.slicePdfIfNeeded(
      file.buffer,
      params.rangeStart,
      params.rangeEnd
    );

    const storageKey = `study-sets/${studySet.id}/files/${params.fileId}.pdf`;
    await this.storage.uploadBuffer({
      key: storageKey,
      body: slicedBuffer,
      contentType: file.mimetype
    });

    const imageKeys: Array<{ pageNumber: number; storageKey: string }> = [];
    if (pageImages.length > 0) {
      const expectedPages = params.rangeEnd - params.rangeStart + 1;
      if (pageImages.length !== expectedPages) {
        this.logger.warn(
          `Received ${pageImages.length} page images but expected ${expectedPages} for ${params.fileId}.`
        );
      }

      for (let index = 0; index < pageImages.length; index += 1) {
        const image = pageImages[index];
        const slicePageNumber = index + 1;
        const pageKey = `study-sets/${studySet.id}/files/${params.fileId}/pages/${slicePageNumber}.png`;
        await this.storage.uploadBuffer({
          key: pageKey,
          body: image.buffer,
          contentType: image.mimetype || 'image/png'
        });
        imageKeys.push({ pageNumber: slicePageNumber, storageKey: pageKey });
      }
    }

    summary.storageKey = storageKey;
    summary.mimeType = file.mimetype;
    summary.storedSizeBytes = slicedBuffer.length;
    summary.selectedRange = {
      start: params.rangeStart,
      end: params.rangeEnd
    };
    summary.rangeSummary = params.rangeSummary ?? `Pages ${params.rangeStart}–${params.rangeEnd}`;
    summary.pageImageKeys = imageKeys;

    await studySet.save();

    return {
      fileId: params.fileId,
      storageKey,
      storedSizeBytes: slicedBuffer.length,
      pageImagesStored: imageKeys.length
    };
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

  private async slicePdfIfNeeded(
    buffer: Buffer,
    rangeStart: number,
    rangeEnd: number
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(buffer);
    const totalPages = pdfDoc.getPageCount();
    const rangeLength = rangeEnd - rangeStart + 1;

    if (rangeLength <= 0) {
      throw new BadRequestException('Invalid page range.');
    }

    if (totalPages === rangeLength) {
      return buffer;
    }

    if (rangeStart < 1 || rangeEnd > totalPages) {
      throw new BadRequestException('Page range exceeds PDF length.');
    }

    const targetDoc = await PDFDocument.create();
    const indices: number[] = [];
    for (let index = rangeStart - 1; index <= rangeEnd - 1; index += 1) {
      indices.push(index);
    }

    const pages = await targetDoc.copyPages(pdfDoc, indices);
    pages.forEach(page => targetDoc.addPage(page));
    const slicedBytes = await targetDoc.save();
    return Buffer.from(slicedBytes);
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

    const requestedFileIds = dto.fileIds ?? [];
    if (!requestedFileIds.length) {
      throw new BadRequestException('fileIds are required to start processing.');
    }

    const fileSnapshots: AiProcessFileSnapshot[] = requestedFileIds.map(fileId => {
      const summary = studySet.fileSummaries.find(item => item.fileId?.toString() === fileId);
      if (!summary) {
        throw new BadRequestException(`File ${fileId} does not belong to this study set.`);
      }
      if (!summary.storageKey) {
        throw new BadRequestException(`File ${summary.fileName} has not been uploaded yet.`);
      }

      return {
        fileId,
        fileName: summary.fileName,
        uploadedAt: summary.uploadedAt,
        extension: summary.extension,
        mimeType: summary.mimeType ?? null,
        sizeBytes: summary.sizeBytes,
        storedSizeBytes: summary.storedSizeBytes ?? null,
        displaySize: summary.displaySize,
        status: 'completed',
        selectedRange: summary.selectedRange ?? null,
        rangeSummary: summary.rangeSummary ?? null,
        storageKey: summary.storageKey ?? null,
        textContent: null,
        pageImageKeys: summary.pageImageKeys ?? [],
        notes: []
      };
    });

    const manualContent = dto.manualContent?.trim() ?? null;
    if (manualContent) {
      const manualSize = Buffer.byteLength(manualContent, 'utf8');
      fileSnapshots.push({
        fileId: `manual-${jobId}`,
        fileName: 'Manual Notes',
        uploadedAt: new Date(),
        extension: 'manual',
        mimeType: 'text/plain',
        sizeBytes: manualSize,
        storedSizeBytes: manualSize,
        displaySize: `${manualSize} chars`,
        status: 'completed',
        selectedRange: null,
        rangeSummary: null,
        storageKey: null,
        textContent: manualContent,
        notes: []
      });
    }

    const payload = {
      preferredLanguage: dto.preferredLanguage ?? null,
      aiFeatures: dto.aiFeatures ?? [],
      manualContent,
      files: fileSnapshots
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
      `Queued AI process ${jobId} for study set ${studySet.id} with ${fileSnapshots.length} file(s)`
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
          studySet: params.job.studySet,
          fileId: params.fileId,
          feature: params.feature
        },
        {
          $set: {
            job: params.job._id,
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

  async deleteStudySet(userId: string, studySetId: string): Promise<void> {
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    await Promise.all([
      this.aiResultModel.deleteMany({ studySet: studySet._id }).exec(),
      this.aiJobModel.deleteMany({ studySet: studySet._id }).exec()
    ]);

    await this.studySetModel.deleteOne({ _id: studySet._id }).exec();
  }
}
