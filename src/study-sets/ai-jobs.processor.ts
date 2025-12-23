import { Injectable, Logger } from '@nestjs/common';
import { StudySetsService } from './study-sets.service';
import { StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import { SummariesService } from '../summaries/summaries.service';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { DocumentProcessingService } from './document-processing.service';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable()
export class AiJobsProcessorService {
  private readonly logger = new Logger(AiJobsProcessorService.name);
  private shouldRun = false;

  constructor(
    private readonly studySetsService: StudySetsService,
    private readonly summariesService: SummariesService,
    private readonly flashcardsService: FlashcardsService,
    private readonly quizzesService: QuizzesService,
    private readonly documentProcessing: DocumentProcessingService
  ) {}

  async processNextJob(): Promise<boolean> {
    const job = await this.studySetsService.claimNextPendingJob();
    if (!job) {
      return false;
    }

    this.logger.log(
      `Processing AI job ${job.jobId} (attempt ${job.attempts}/${job.maxAttempts})`
    );

    try {
      await this.runAiPipeline(job);
      await this.studySetsService.markJobCompleted(job.jobId);
      this.logger.log(`Completed AI job ${job.jobId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI job ${job.jobId} failed: ${message}`);
      await this.studySetsService.markJobFailed(job.jobId, message);
    }

    return true;
  }

  private async runAiPipeline(job: StudySetAiJobDocument): Promise<void> {
    const files = job.payload?.files ?? [];
    const features = (job.payload?.aiFeatures ?? []) as string[];

    const results = await Promise.all(
      files.map(file => this.processFile(job, file, features))
    );

    const errors = results.flat();
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  }

  private async processFile(
    job: StudySetAiJobDocument,
    file: any,
    features: string[]
  ): Promise<string[]> {
    const errors: string[] = [];
    let studySource = '';

    try {
      studySource = await this.documentProcessing.buildStudySource(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await Promise.all(
        features.map(feature =>
          this.studySetsService.upsertAiResult({
            job,
            fileId: file.fileId,
            fileName: file.fileName,
            feature: feature as any,
            status: 'failed',
            error: message
          })
        )
      );
      return [message];
    }

    // Process summary first for faster partial results.
    const summaryRequested = features.includes('summary');
    const remainingFeatures = features.filter(feature => feature !== 'summary');

    if (summaryRequested) {
      try {
        await this.processFeature(job, file, 'summary', studySource);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
      }
    }

    await Promise.all(
      remainingFeatures.map(async feature => {
        try {
          await this.processFeature(job, file, feature as string, studySource);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(message);
        }
      })
    );

    return errors;
  }

  private async processFeature(
    job: StudySetAiJobDocument,
    file: any,
    feature: string,
    studySource: string
  ): Promise<void> {
    const supportedFeatures = ['summary', 'flashcards', 'quizzes'];
    if (!supportedFeatures.includes(feature)) {
      const message = `Unsupported feature ${feature}`;
      await this.studySetsService.upsertAiResult({
        job,
        fileId: file.fileId,
        fileName: file.fileName,
        feature: feature as any,
        status: 'failed',
        error: message
      });
      throw new Error(message);
    }

    await this.studySetsService.upsertAiResult({
      job,
      fileId: file.fileId,
      fileName: file.fileName,
      feature: feature as any,
      status: 'processing'
    });

    try {
      this.logger.log(`Processing ${feature} for file ${file.fileName}`);
      if (feature === 'summary') {
        const summary = await this.summariesService.generateStructuredSummary(studySource, file.fileName);
        await this.studySetsService.upsertAiResult({
          job,
          fileId: file.fileId,
          fileName: file.fileName,
          feature: 'summary',
          status: 'completed',
          result: summary
        });
        return;
      }

      if (feature === 'flashcards') {
        const cards = await this.flashcardsService.generateFlashcards(
          studySource,
          file.fileName
        );
        await this.studySetsService.upsertAiResult({
          job,
          fileId: file.fileId,
          fileName: file.fileName,
          feature: 'flashcards',
          status: 'completed',
          result: cards
        });
        return;
      }

      if (feature === 'quizzes') {
        const quiz = await this.quizzesService.generateQuiz(studySource, file.fileName);
        await this.studySetsService.upsertAiResult({
          job,
          fileId: file.fileId,
          fileName: file.fileName,
          feature: 'quizzes',
          status: 'completed',
          result: quiz
        });
        return;
      }
      this.logger.log(`Completed ${feature} for ${file.fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed ${feature} for ${file.fileName}: ${message}`);
      await this.studySetsService.upsertAiResult({
        job,
        fileId: file.fileId,
        fileName: file.fileName,
        feature: feature as any,
        status: 'failed',
        error: message
      });
      throw new Error(`${feature}:${file.fileName} → ${message}`);
    }
  }


  async startPolling(pollIntervalMs = 5000): Promise<void> {
    if (this.shouldRun) {
      return;
    }

    this.shouldRun = true;
    this.logger.log('AI job processor started');

    while (this.shouldRun) {
      const processed = await this.processNextJob();
      if (!processed) {
        await wait(pollIntervalMs);
      }
    }
  }

  stop(): void {
    this.logger.log('AI job processor stopping');
    this.shouldRun = false;
  }
}
