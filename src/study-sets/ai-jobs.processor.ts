import { Injectable, Logger } from '@nestjs/common';
import { StudySetsService } from './study-sets.service';
import { StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import { SummariesService } from '../summaries/summaries.service';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { CombinedAIService } from '../ai/combined-ai.service';

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
    private readonly combinedAIService: CombinedAIService
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

    // Check if all three features are requested - use combined service for optimization
    const hasAllFeatures = ['summary', 'flashcards', 'quizzes'].every(f => features.includes(f));

    if (hasAllFeatures) {
      this.logger.log(`Using combined AI service for file ${file.fileName} (all features requested)`);
      try {
        await this.processCombinedFeatures(job, file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
      }
    } else {
      // Process features individually
      await Promise.all(
        features.map(async feature => {
          try {
            await this.processFeature(job, file, feature as string);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(message);
          }
        })
      );
    }

    return errors;
  }

  private async processCombinedFeatures(job: StudySetAiJobDocument, file: any): Promise<void> {
    const features = ['summary', 'flashcards', 'quizzes'];

    // Mark all features as processing
    await Promise.all(
      features.map(feature =>
        this.studySetsService.upsertAiResult({
          job,
          fileId: file.fileId,
          fileName: file.fileName,
          feature: feature as any,
          status: 'processing'
        })
      )
    );

    try {
      const text = this.getContentForFile(file);
      this.logger.log(`Generating all features for file ${file.fileName} using combined service`);

      const combined = await this.combinedAIService.generateAll(text, file.fileName);

      // Save summary result
      await this.studySetsService.upsertAiResult({
        job,
        fileId: file.fileId,
        fileName: file.fileName,
        feature: 'summary',
        status: 'completed',
        result: {
          model: combined.model,
          promptVersion: combined.promptVersion,
          summary: combined.data.summary,
          rawResponse: combined.rawResponse
        }
      });

      // Save flashcards result
      await this.studySetsService.upsertAiResult({
        job,
        fileId: file.fileId,
        fileName: file.fileName,
        feature: 'flashcards',
        status: 'completed',
        result: {
          model: combined.model,
          promptVersion: combined.promptVersion,
          flashcards: combined.data.flashcards,
          rawResponse: combined.rawResponse
        }
      });

      // Save quizzes result
      await this.studySetsService.upsertAiResult({
        job,
        fileId: file.fileId,
        fileName: file.fileName,
        feature: 'quizzes',
        status: 'completed',
        result: {
          model: combined.model,
          promptVersion: combined.promptVersion,
          questions: combined.data.quizzes,
          rawResponse: combined.rawResponse
        }
      });

      this.logger.log(`Completed all features for ${file.fileName} using combined service`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Combined service failed for ${file.fileName}: ${message}`);

      // Mark all features as failed
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

      throw new Error(`combined:${file.fileName} → ${message}`);
    }
  }

  private async processFeature(job: StudySetAiJobDocument, file: any, feature: string): Promise<void> {
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
        const text = this.getContentForFile(file);
        const summary = await this.summariesService.generateStructuredSummary(text, file.fileName);
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
          this.getContentForFile(file),
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
        const quiz = await this.quizzesService.generateQuiz(this.getContentForFile(file), file.fileName);
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

  private getContentForFile(file: any): string {
    const text = (file?.extractedText ?? '').toString().trim();
    if (!text) {
      throw new Error('No extracted text available for this file');
    }

    return text;
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
