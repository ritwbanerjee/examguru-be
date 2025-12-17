import { Injectable, Logger } from '@nestjs/common';
import { StudySetsService } from './study-sets.service';
import { StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import { SummariesService } from '../summaries/summaries.service';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable()
export class AiJobsProcessorService {
  private readonly logger = new Logger(AiJobsProcessorService.name);
  private shouldRun = false;

  constructor(
    private readonly studySetsService: StudySetsService,
    private readonly summariesService: SummariesService
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
    const errors: string[] = [];

    for (const file of files) {
      for (const feature of features) {
        await this.processFeature(job, file, feature as string, errors);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  }

  private async processFeature(
    job: StudySetAiJobDocument,
    file: any,
    feature: string,
    errors: string[]
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
      errors.push(message);
      return;
    }

    await this.studySetsService.upsertAiResult({
      job,
      fileId: file.fileId,
      fileName: file.fileName,
      feature: feature as any,
      status: 'processing'
    });

    try {
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
        const cards = this.buildFlashcards(this.getContentForFile(file));
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
        const quiz = this.buildQuiz(this.getContentForFile(file));
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.studySetsService.upsertAiResult({
        job,
        fileId: file.fileId,
        fileName: file.fileName,
        feature: feature as any,
        status: 'failed',
        error: message
      });
      errors.push(`${feature}:${file.fileName} → ${message}`);
    }
  }

  private getContentForFile(file: any): string {
    const text = (file?.extractedText ?? '').toString().trim();
    if (!text) {
      throw new Error('No extracted text available for this file');
    }

    return text;
  }

  private buildFlashcards(text: string) {
    const sentences = this.extractKeySentences(text, 5);
    return sentences.map((sentence, index) => ({
      id: `flashcard-${index + 1}`,
      prompt: `Key concept ${index + 1}`,
      answer: sentence
    }));
  }

  private buildQuiz(text: string) {
    const sentences = this.extractKeySentences(text, 3);
    return sentences.map((sentence, index) => ({
      id: `quiz-${index + 1}`,
      question: `What is the main idea behind: "${sentence.slice(0, 80)}..."?`,
      options: ['Application', 'Definition', 'Process', 'Example'],
      correctIndex: index % 4,
      explanation: sentence
    }));
  }

  private extractKeySentences(text: string, max = 5): string[] {
    const sentences = text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);

    if (sentences.length === 0) {
      return [text];
    }

    return sentences.slice(0, max).map(sentence => sentence.trim());
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
