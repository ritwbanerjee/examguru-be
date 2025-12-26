import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Express } from 'express';
import { PDFDocument } from 'pdf-lib';
import { CreateStudySetDto } from './dto/create-study-set.dto';
import { StudySet, StudySetDocument } from './schemas/study-set.schema';
import { StartAiProcessDto } from './dto/start-ai-process.dto';
import { UpdateSummaryDto } from './dto/update-summary.dto';
import { randomUUID } from 'crypto';
import { AiProcessFileSnapshot, StudySetAiJob, StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import {
  StudySetAiResult,
  StudySetAiResultDocument,
  StudySetAiFeature,
  StudySetAiResultStatus
} from './schemas/study-set-ai-result.schema';
import { R2StorageService } from '../storage/r2-storage.service';
import { FlashcardProgress, FlashcardProgressDocument } from '../flashcards/schemas/flashcard-progress.schema';
import { StudySession, StudySessionDocument } from '../flashcards/schemas/study-session.schema';
import { UsersService } from '../users/users.service';

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
    @InjectModel(FlashcardProgress.name)
    private readonly flashcardProgressModel: Model<FlashcardProgressDocument>,
    @InjectModel(StudySession.name)
    private readonly studySessionModel: Model<StudySessionDocument>,
    private readonly storage: R2StorageService,
    private readonly usersService: UsersService
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

    const saved = await created.save();

    // Increment user's total uploads counter
    await this.usersService.incrementTotalUploads(userId);

    return saved;
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

  async addStudySetFiles(
    userId: string,
    studySetId: string,
    fileSummaries: Array<{
      fileName: string;
      uploadedAt: string;
      extension: string;
      sizeBytes: number;
      displaySize: string;
    }>
  ): Promise<{ studySetId: string; fileSummaries: Array<{ fileId: string; fileName: string; uploadedAt: string; extension: string; sizeBytes: number; displaySize: string }> }> {
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    const added = fileSummaries.map(summary => ({
      fileId: new Types.ObjectId(),
      fileName: summary.fileName,
      uploadedAt: new Date(summary.uploadedAt),
      extension: summary.extension,
      sizeBytes: summary.sizeBytes,
      displaySize: summary.displaySize,
      storageKey: null,
      mimeType: null,
      storedSizeBytes: null,
      selectedRange: null,
      rangeSummary: null,
      pageImageKeys: []
    }));

    studySet.fileSummaries.push(...added);
    await studySet.save();

    return {
      studySetId: studySet.id,
      fileSummaries: added.map(summary => ({
        fileId: summary.fileId.toString(),
        fileName: summary.fileName,
        uploadedAt: summary.uploadedAt.toISOString(),
        extension: summary.extension,
        sizeBytes: summary.sizeBytes,
        displaySize: summary.displaySize
      }))
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

  async getResultsForStudySetFile(
    userId: string,
    studySetId: string,
    fileId: string
  ): Promise<{ fileName: string; fileId: string; results: StudySetAiResultDocument[] }> {
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    const summary = studySet.fileSummaries.find(item => item.fileId?.toString() === fileId);
    if (!summary) {
      throw new NotFoundException('File not found for this study set');
    }

    const results = await this.aiResultModel
      .find({ studySet: studySet._id, fileId })
      .sort({ feature: 1 })
      .exec();

    const fileName = results[0]?.fileName ?? summary.fileName;

    return {
      fileId,
      fileName,
      results
    };
  }

  async updateSummary(
    userId: string,
    studySetId: string,
    fileId: string,
    dto: UpdateSummaryDto
  ): Promise<void> {
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    const aiResult = await this.aiResultModel
      .findOne({
        studySet: studySet._id,
        fileId,
        feature: 'summary'
      })
      .exec();

    if (!aiResult) {
      throw new NotFoundException('Summary not found for this file');
    }

    // Get the current result
    const currentResult = aiResult.result as { summary?: any } | null;
    const currentSummary = currentResult?.summary || {};

    // Merge the updates with the existing summary
    const updatedSummary = {
      ...currentSummary,
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.summary !== undefined && { summary: dto.summary }),
      ...(dto.detailed_summary !== undefined && { detailed_summary: dto.detailed_summary }),
      ...(dto.key_points !== undefined && { key_points: dto.key_points }),
      ...(dto.study_recommendations !== undefined && { study_recommendations: dto.study_recommendations })
    };

    // Update the result
    aiResult.result = {
      ...currentResult,
      summary: updatedSummary
    };

    await aiResult.save();
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

  async getFlashcardsWithProgress(
    userId: string,
    studySetId: string,
    filters?: { mastery?: string; difficulty?: string; fileId?: string }
  ): Promise<{
    studySetId: string;
    totalCards: number;
    masteredCards: number;
    unmasteredCards: number;
    lastStudied: Date | null;
    groups: Array<{
      fileId: string;
      fileName: string;
      totalCards: number;
      masteredCards: number;
      cards: Array<any>;
    }>;
  }> {
    // Verify user owns study set
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    // Fetch AI results (flashcards) from studysetairesults collection
    const aiResults = await this.aiResultModel
      .find({
        studySet: studySet._id,
        feature: 'flashcards',
        status: 'completed'
      })
      .exec();

    if (aiResults.length === 0) {
      return {
        studySetId,
        totalCards: 0,
        masteredCards: 0,
        unmasteredCards: 0,
        lastStudied: null,
        groups: []
      };
    }

    // Fetch all user progress for this study set
    const userObjectId = new Types.ObjectId(userId);
    const userProgress = await this.flashcardProgressModel
      .find({
        user: { $in: [userObjectId, userId] },
        studySet: { $in: [studySet._id, studySetId] }
      })
      .exec();

    // Create a map for quick progress lookup
    const progressMap = new Map(userProgress.map(p => [p.flashcardId, p]));

    // Find latest study session for lastStudied
    const latestProgress = userProgress.reduce(
      (latest, current) => {
        if (!current.lastReviewed) return latest;
        if (!latest || current.lastReviewed > latest) return current.lastReviewed;
        return latest;
      },
      null as Date | null
    );

    const groups: Array<{
      fileId: string;
      fileName: string;
      totalCards: number;
      masteredCards: number;
      cards: Array<any>;
    }> = [];

    // Calculate counts and build groups in a single pass
    // Counts will reflect the fileId filter if applied
    let totalCards = 0;
    let totalMasteredCards = 0;

    for (const aiResult of aiResults) {
      const flashcardsData = aiResult.result as any;
      const flashcards = flashcardsData?.flashcards || [];

      if (!Array.isArray(flashcards) || flashcards.length === 0) {
        continue;
      }

      // Filter by fileId if specified
      if (filters?.fileId && aiResult.fileId !== filters.fileId) {
        continue;
      }

      const cards: Array<any> = [];
      let groupMasteredCount = 0;

      for (const card of flashcards) {
        const progress = progressMap.get(card.id);
        const mastered = progress?.mastered ?? false;

        // Count this card for totals (before applying mastery/difficulty filters)
        totalCards++;
        if (mastered) {
          totalMasteredCards++;
        }

        // Filter by difficulty if specified
        if (filters?.difficulty) {
          const allowedDifficulties = filters.difficulty.split(',').map(d => d.trim());
          if (!allowedDifficulties.includes(card.difficulty)) {
            continue;
          }
        }

        const timesStudied = progress?.timesStudied ?? 0;
        const lastReviewed = progress?.lastReviewed ?? null;

        // Filter by mastery if specified
        if (filters?.mastery) {
          if (filters.mastery === 'mastered' && !mastered) continue;
          if (filters.mastery === 'unmastered' && mastered) continue;
        }

        const mergedCard = {
          id: card.id,
          studySetId,
          fileId: aiResult.fileId,
          sourceFile: aiResult.fileName,
          prompt: card.prompt,
          answer: card.answer,
          followUp: card.followUp,
          difficulty: card.difficulty,
          isEdited: card.isEdited ?? false,
          editedAt: card.editedAt ?? null,
          mastered,
          timesStudied,
          lastReviewed,
          createdAt: aiResult.createdAt
        };

        cards.push(mergedCard);

        if (mastered) {
          groupMasteredCount++;
        }
      }

      if (cards.length > 0) {
        groups.push({
          fileId: aiResult.fileId,
          fileName: aiResult.fileName,
          totalCards: cards.length,
          masteredCards: groupMasteredCount,
          cards
        });
      }
    }

    return {
      studySetId,
      totalCards,
      masteredCards: totalMasteredCards,
      unmasteredCards: totalCards - totalMasteredCards,
      lastStudied: latestProgress,
      groups
    };
  }

  async updateFlashcardProgress(
    userId: string,
    flashcardId: string,
    updates: { mastered?: boolean; answeredCorrectly?: boolean }
  ): Promise<{
    flashcardId: string;
    mastered: boolean;
    timesStudied: number;
    timesCorrect: number;
    timesIncorrect: number;
    lastReviewed: Date;
    firstStudied: Date;
  }> {
    // Parse flashcard ID to extract studySetId
    // Format: fc_<studySetId>_<fileId>_<index>
    const parts = flashcardId.split('_');
    if (parts.length < 4 || parts[0] !== 'fc') {
      throw new BadRequestException('Invalid flashcard ID format');
    }
    const studySetId = parts[1];

    // Verify user owns the study set
    const studySet = await this.studySetModel
      .findOne({
        _id: new Types.ObjectId(studySetId),
        user: new Types.ObjectId(userId)
      })
      .exec();

    if (!studySet) {
      throw new ForbiddenException('You do not have access to this flashcard');
    }

    // Find existing progress or create new document
    const userObjectId = new Types.ObjectId(userId);
    const progress = await this.flashcardProgressModel
      .findOne({
        user: { $in: [userObjectId, userId] },
        studySet: { $in: [studySet._id, studySetId] },
        flashcardId
      })
      .exec();

    const now = new Date();

    let progressDoc = progress;
    if (!progressDoc) {
      // Fetch flashcard details from AI results to populate denormalized fields
      const aiResults = await this.aiResultModel.find({
        studySet: studySet._id,
        feature: 'flashcards',
        status: 'completed'
      });

      let foundCard: {
        prompt: string;
        sourceFile: string;
        difficulty: 'intro' | 'intermediate' | 'advanced';
      } | null = null;

      for (const result of aiResults) {
        const resultData = result.result as
          | Array<{ id: string; prompt: string; difficulty: string }>
          | { flashcards?: Array<{ id: string; prompt: string; difficulty: string }> }
          | null;
        const flashcards = Array.isArray(resultData)
          ? resultData
          : Array.isArray(resultData?.flashcards)
            ? resultData.flashcards
            : [];
        const card = flashcards.find(fc => fc.id === flashcardId);
        if (card) {
          foundCard = {
            prompt: card.prompt,
            sourceFile: result.fileName,
            difficulty: card.difficulty as 'intro' | 'intermediate' | 'advanced'
          };
          break;
        }
      }

      if (!foundCard) {
        throw new NotFoundException('Flashcard not found in AI results');
      }

      // Create new progress document
      progressDoc = new this.flashcardProgressModel({
        user: userObjectId,
        studySet: studySet._id,
        flashcardId,
        prompt: foundCard.prompt,
        sourceFile: foundCard.sourceFile,
        difficulty: foundCard.difficulty,
        mastered: false,
        timesStudied: 0,
        timesCorrect: 0,
        timesIncorrect: 0,
        lastReviewed: null,
        firstStudied: null
      });
    }

    // Update progress fields
    progressDoc.timesStudied += 1;
    progressDoc.lastReviewed = now;
    if (!progressDoc.firstStudied) {
      progressDoc.firstStudied = now;
    }

    if (updates.mastered !== undefined) {
      progressDoc.mastered = updates.mastered;
    }

    if (updates.answeredCorrectly !== undefined) {
      if (updates.answeredCorrectly) {
        progressDoc.timesCorrect += 1;
      } else {
        progressDoc.timesIncorrect += 1;
      }
    }

    try {
      await progressDoc.save();
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        progressDoc = await this.flashcardProgressModel
          .findOne({
            user: { $in: [userObjectId, userId] },
            studySet: { $in: [studySet._id, studySetId] },
            flashcardId
          })
          .exec();
        if (!progressDoc) {
          throw error;
        }
        progressDoc.timesStudied += 1;
        progressDoc.lastReviewed = now;
        if (updates.mastered !== undefined) {
          progressDoc.mastered = updates.mastered;
        }
        if (updates.answeredCorrectly !== undefined) {
          if (updates.answeredCorrectly) {
            progressDoc.timesCorrect += 1;
          } else {
            progressDoc.timesIncorrect += 1;
          }
        }
        await progressDoc.save();
      } else {
        throw error;
      }
    }

    return {
      flashcardId: progressDoc.flashcardId,
      mastered: progressDoc.mastered,
      timesStudied: progressDoc.timesStudied,
      timesCorrect: progressDoc.timesCorrect,
      timesIncorrect: progressDoc.timesIncorrect,
      lastReviewed: progressDoc.lastReviewed ?? now,
      firstStudied: progressDoc.firstStudied ?? now
    };
  }

  async createStudySession(
    userId: string,
    studySetId: string,
    filterType: 'all' | 'unmastered' | 'mastered'
  ): Promise<{
    sessionId: string;
    studySetId: string;
    filterType: string;
    startedAt: Date;
    completedAt: Date | null;
    duration: number;
    cardsStudied: number;
    cardsMastered: number;
    cardsNeedingReview: number;
    flashcardIds: string[];
  }> {
    // Verify user owns the study set
    const studySet = await this.studySetModel
      .findOne({
        _id: new Types.ObjectId(studySetId),
        user: new Types.ObjectId(userId)
      })
      .exec();

    if (!studySet) {
      const existing = await this.studySetModel.findById(studySetId).exec();
      if (existing) {
        throw new ForbiddenException('You do not have access to this study set');
      }
      throw new NotFoundException('Study set not found');
    }

    // Create new study session
    const session = new this.studySessionModel({
      user: new Types.ObjectId(userId),
      studySet: new Types.ObjectId(studySetId),
      filterType,
      startedAt: new Date(),
      completedAt: null,
      duration: 0,
      cardsStudied: 0,
      cardsMastered: 0,
      cardsNeedingReview: 0,
      flashcardIds: []
    });

    await session.save();

    return {
      sessionId: session._id.toString(),
      studySetId: session.studySet.toString(),
      filterType: session.filterType,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      duration: session.duration,
      cardsStudied: session.cardsStudied,
      cardsMastered: session.cardsMastered,
      cardsNeedingReview: session.cardsNeedingReview,
      flashcardIds: session.flashcardIds
    };
  }

  async updateStudySession(
    userId: string,
    sessionId: string,
    updates: {
      duration?: number;
      cardsStudied?: number;
      cardsMastered?: number;
      cardsNeedingReview?: number;
      flashcardIds?: string[];
    }
  ): Promise<{
    sessionId: string;
    studySetId: string;
    filterType: string;
    startedAt: Date;
    completedAt: Date | null;
    duration: number;
    cardsStudied: number;
    cardsMastered: number;
    cardsNeedingReview: number;
    flashcardIds: string[];
  }> {
    // Find the session and verify ownership
    const session = await this.studySessionModel.findById(sessionId);

    if (!session) {
      throw new NotFoundException('Study session not found');
    }

    // Verify user owns the session
    if (session.user.toString() !== userId) {
      throw new BadRequestException('You do not have access to this study session');
    }

    // Update fields if provided
    if (updates.duration !== undefined) {
      session.duration = updates.duration;
    }
    if (updates.cardsStudied !== undefined) {
      session.cardsStudied = updates.cardsStudied;
    }
    if (updates.cardsMastered !== undefined) {
      session.cardsMastered = updates.cardsMastered;
    }
    if (updates.cardsNeedingReview !== undefined) {
      session.cardsNeedingReview = updates.cardsNeedingReview;
    }
    if (updates.flashcardIds !== undefined) {
      session.flashcardIds = updates.flashcardIds;
    }

    // Mark as completed when we have final stats
    if (!session.completedAt && (updates.duration !== undefined || updates.cardsStudied !== undefined)) {
      session.completedAt = new Date();
    }

    await session.save();

    return {
      sessionId: session._id.toString(),
      studySetId: session.studySet.toString(),
      filterType: session.filterType,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      duration: session.duration,
      cardsStudied: session.cardsStudied,
      cardsMastered: session.cardsMastered,
      cardsNeedingReview: session.cardsNeedingReview,
      flashcardIds: session.flashcardIds
    };
  }

  async createFlashcard(
    userId: string,
    studySetId: string,
    dto: { prompt: string; answer: string; followUp?: string; difficulty?: string; fileId?: string }
  ): Promise<any> {
    // Verify study set ownership
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    // Use provided fileId or create a custom one
    const fileId = dto.fileId || 'custom_flashcards';
    const fileName = dto.fileId ? 'Custom Flashcard' : 'Custom Flashcards';

    // Find or create the AI result document for custom flashcards
    let aiResult = await this.aiResultModel
      .findOne({
        studySet: studySet._id,
        fileId,
        feature: 'flashcards'
      })
      .exec();

    if (!aiResult) {
      // Create a new AI result for custom flashcards
      aiResult = await this.aiResultModel.create({
        job: new Types.ObjectId(), // Create a dummy job ID
        studySet: studySet._id,
        fileId,
        fileName,
        feature: 'flashcards',
        status: 'completed',
        result: { flashcards: [] }
      });
    }

    // Generate flashcard ID
    const flashcardsData = aiResult.result as any;
    const flashcards = Array.isArray(flashcardsData?.flashcards) ? flashcardsData.flashcards : [];
    const index = flashcards.length;
    const flashcardId = `fc_${studySetId}_${fileId}_${index.toString().padStart(3, '0')}`;

    // Create the new flashcard
    const newFlashcard = {
      id: flashcardId,
      prompt: dto.prompt,
      answer: dto.answer,
      followUp: dto.followUp || null,
      difficulty: dto.difficulty || 'intermediate',
      isEdited: true,
      editedAt: new Date().toISOString()
    };

    // Add to flashcards array
    flashcards.push(newFlashcard);
    aiResult.result = { flashcards };
    aiResult.markModified('result');
    await aiResult.save();

    return {
      id: flashcardId,
      studySetId,
      fileId,
      sourceFile: fileName,
      prompt: newFlashcard.prompt,
      answer: newFlashcard.answer,
      followUp: newFlashcard.followUp,
      difficulty: newFlashcard.difficulty,
      isEdited: true,
      createdAt: new Date().toISOString()
    };
  }

  async updateFlashcard(
    userId: string,
    flashcardId: string,
    dto: { prompt?: string; answer?: string; followUp?: string; difficulty?: string }
  ): Promise<any> {
    // Parse flashcard ID: fc_<studySetId>_<fileId>_<index>
    const parts = flashcardId.split('_');
    if (parts.length < 4 || parts[0] !== 'fc') {
      throw new BadRequestException('Invalid flashcard ID format');
    }

    const studySetId = parts[1];
    const fileId = parts.slice(2, -1).join('_');
    const index = parseInt(parts[parts.length - 1], 10);

    // Verify study set ownership
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    // Find the AI result
    const aiResult = await this.aiResultModel
      .findOne({
        studySet: studySet._id,
        fileId,
        feature: 'flashcards'
      })
      .exec();

    if (!aiResult) {
      throw new NotFoundException('Flashcard group not found');
    }

    const flashcardsData = aiResult.result as any;
    const flashcards = flashcardsData?.flashcards || [];

    if (index < 0 || index >= flashcards.length) {
      throw new NotFoundException('Flashcard not found');
    }

    const flashcard = flashcards[index];

    // Update fields
    if (dto.prompt !== undefined) flashcard.prompt = dto.prompt;
    if (dto.answer !== undefined) flashcard.answer = dto.answer;
    if (dto.followUp !== undefined) flashcard.followUp = dto.followUp;
    if (dto.difficulty !== undefined) flashcard.difficulty = dto.difficulty;

    flashcard.isEdited = true;
    flashcard.editedAt = new Date().toISOString();

    aiResult.result = { flashcards };
    aiResult.markModified('result');
    await aiResult.save();

    return {
      id: flashcardId,
      studySetId,
      fileId,
      sourceFile: aiResult.fileName,
      prompt: flashcard.prompt,
      answer: flashcard.answer,
      followUp: flashcard.followUp,
      difficulty: flashcard.difficulty,
      isEdited: flashcard.isEdited,
      editedAt: flashcard.editedAt
    };
  }

  async deleteFlashcard(userId: string, flashcardId: string): Promise<void> {
    // Parse flashcard ID: fc_<studySetId>_<fileId>_<index>
    const parts = flashcardId.split('_');
    if (parts.length < 4 || parts[0] !== 'fc') {
      throw new BadRequestException('Invalid flashcard ID format');
    }

    const studySetId = parts[1];
    const fileId = parts.slice(2, -1).join('_');
    const index = parseInt(parts[parts.length - 1], 10);

    // Verify study set ownership
    const studySet = await this.studySetModel
      .findOne({ _id: new Types.ObjectId(studySetId), user: new Types.ObjectId(userId) })
      .exec();

    if (!studySet) {
      throw new NotFoundException('Study set not found');
    }

    // Find the AI result
    const aiResult = await this.aiResultModel
      .findOne({
        studySet: studySet._id,
        fileId,
        feature: 'flashcards'
      })
      .exec();

    if (!aiResult) {
      throw new NotFoundException('Flashcard group not found');
    }

    const flashcardsData = aiResult.result as any;
    const flashcards = flashcardsData?.flashcards || [];

    if (index < 0 || index >= flashcards.length) {
      throw new NotFoundException('Flashcard not found');
    }

    // Remove the flashcard
    flashcards.splice(index, 1);

    // Re-generate IDs for all flashcards after the deleted one
    for (let i = index; i < flashcards.length; i++) {
      flashcards[i].id = `fc_${studySetId}_${fileId}_${i.toString().padStart(3, '0')}`;
    }

    aiResult.result = { flashcards };
    aiResult.markModified('result');
    await aiResult.save();

    // Also delete any progress records for this flashcard
    await this.flashcardProgressModel.deleteMany({ flashcardId }).exec();
  }
}
