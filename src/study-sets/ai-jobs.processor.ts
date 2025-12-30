import { Injectable, Logger } from '@nestjs/common';
import { StudySetsService } from './study-sets.service';
import { StudySetAiJobDocument } from './schemas/study-set-ai-job.schema';
import { SummariesService } from '../summaries/summaries.service';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { DocumentProcessingService, ProcessingStats } from './document-processing.service';
import { ProcessingLimitError } from './errors/processing-limit.error';
import { UsersService } from '../users/users.service';
import { PlansService } from '../plans/plans.service';
import { PlanDefinition } from '../plans/plan-config';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type FeatureOutput = {
  feature: 'summary' | 'flashcards' | 'quizzes';
  result: unknown;
  usage: TokenUsage;
};

type FileOutput = {
  fileId: string;
  fileName: string;
  outputs: FeatureOutput[];
  stats: ProcessingStats;
  usage: TokenUsage;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

@Injectable()
export class AiJobsProcessorService {
  private readonly logger = new Logger(AiJobsProcessorService.name);
  private shouldRun = false;

  constructor(
    private readonly studySetsService: StudySetsService,
    private readonly summariesService: SummariesService,
    private readonly flashcardsService: FlashcardsService,
    private readonly quizzesService: QuizzesService,
    private readonly documentProcessing: DocumentProcessingService,
    private readonly usersService: UsersService,
    private readonly plansService: PlansService
  ) {}

  private emptyUsage(): TokenUsage {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  private addUsage(target: TokenUsage, usage?: TokenUsage | null): void {
    if (!usage) {
      return;
    }
    target.inputTokens += usage.inputTokens;
    target.outputTokens += usage.outputTokens;
    target.totalTokens += usage.totalTokens;
  }

  private splitUsage(result: unknown): { result: unknown; usage: TokenUsage } {
    if (result && typeof result === 'object' && 'usage' in result) {
      const { usage, ...rest } = result as { usage?: TokenUsage };
      return {
        result: rest,
        usage: usage ?? this.emptyUsage()
      };
    }
    return { result, usage: this.emptyUsage() };
  }

  private extractLimitDetails(
    response: unknown
  ): { code?: string; meta?: Record<string, unknown> } | undefined {
    if (!response || typeof response !== 'object') {
      return undefined;
    }
    const payload = response as Record<string, unknown>;
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    const meta: Record<string, unknown> = {};
    if ('upgradeEligible' in payload) {
      meta.upgradeEligible = payload.upgradeEligible;
    }
    if ('upgradePlanId' in payload) {
      meta.upgradePlanId = payload.upgradePlanId;
    }
    if ('upgradePlanName' in payload) {
      meta.upgradePlanName = payload.upgradePlanName;
    }
    if (!code && Object.keys(meta).length === 0) {
      return undefined;
    }
    return { code, meta };
  }

  async processNextJob(): Promise<boolean> {
    const job = await this.studySetsService.claimNextPendingJob();
    if (!job) {
      return false;
    }

    this.logger.log(
      `Processing AI job ${job.jobId} (attempt ${job.attempts}/${job.maxAttempts})`
    );

    try {
      await this.studySetsService.assertJobCanStart(job);
    } catch (error) {
      const response = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: unknown }).response
        : undefined;
      const responseMessage = response && typeof response === 'object' && 'message' in response
        ? (response as { message?: string }).message
        : undefined;
      const message = responseMessage ?? (error instanceof Error ? error.message : String(error));
      const details = response ? this.extractLimitDetails(response) : undefined;
      await this.studySetsService.markJobAborted(job.jobId, message, details);
      this.logger.warn(`AI job ${job.jobId} aborted at start: ${message}`);
      return true;
    }

    try {
      const outputs = await this.runAiPipeline(job);
      await this.studySetsService.finalizeJobSuccess(job.jobId, outputs);
      this.logger.log(`Completed AI job ${job.jobId}`);
    } catch (error) {
      if (error instanceof ProcessingLimitError) {
        await this.studySetsService.markJobAborted(job.jobId, error.message, {
          code: error.code,
          meta: error.meta
        });
        this.logger.warn(`AI job ${job.jobId} aborted: ${error.message}`);
        return true;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI job ${job.jobId} failed: ${message}`);
      await this.studySetsService.markJobFailed(job.jobId, message);
    }

    return true;
  }

  private async runAiPipeline(job: StudySetAiJobDocument): Promise<FileOutput[]> {
    const files = job.payload?.files ?? [];
    const features = (job.payload?.aiFeatures ?? []) as string[];
    const plan = await this.resolvePlan(job);
    const allowVision = plan.id === 'pro_plus';

    const outputs: FileOutput[] = [];
    for (const file of files) {
      outputs.push(await this.processFile(job, file, features, allowVision));
    }

    const upserts: Array<Promise<void>> = [];
    for (const fileOutput of outputs) {
      for (const output of fileOutput.outputs) {
        upserts.push(
          this.studySetsService.upsertAiResult({
            job,
            fileId: fileOutput.fileId,
            fileName: fileOutput.fileName,
            feature: output.feature,
            status: 'completed',
            result: output.result
          })
        );
      }
    }

    await Promise.all(upserts);
    return outputs;
  }

  private async processFile(
    job: StudySetAiJobDocument,
    file: any,
    features: string[],
    allowVision: boolean
  ): Promise<FileOutput> {
    let studySource = '';
    let stats: ProcessingStats | null = null;

    try {
      const pageCount = this.resolveFilePageCount(file);
      const visionPageCap = allowVision ? this.computeVisionPageCap(pageCount) : 0;
      const result = await this.documentProcessing.buildStudySourceWithStats(file, {
        allowVision,
        visionPageCap
      });
      studySource = result.text;
      stats = result.stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }

    if (stats) {
      await this.studySetsService.assertProcessingWithinLimits(job, stats);
    }

    const outputs: FeatureOutput[] = [];
    const fileUsage = this.emptyUsage();
    if (stats) {
      this.addUsage(fileUsage, {
        inputTokens: stats.inputTokens ?? 0,
        outputTokens: stats.outputTokens ?? 0,
        totalTokens: stats.totalTokens ?? 0
      });
    }
    for (const feature of features) {
      const result = await this.processFeature(job, file, feature as string, studySource);
      this.addUsage(fileUsage, result.usage);
      outputs.push({
        feature: feature as FeatureOutput['feature'],
        result: result.result,
        usage: result.usage
      });
    }

    return {
      fileId: file.fileId,
      fileName: file.fileName,
      outputs,
      stats: stats ?? {
        totalPages: 0,
        ocrPages: 0,
        visionPages: 0,
        visionImages: 0,
        visionUnits: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      usage: fileUsage
    };
  }

  private async resolvePlan(job: StudySetAiJobDocument): Promise<PlanDefinition> {
    const user = await this.usersService.findById(job.user.toString());
    if (!user) {
      return this.plansService.getPlanDefinition('free');
    }
    return this.plansService.getPlanDefinition(user.plan);
  }

  private resolveFilePageCount(file: any): number {
    const range = file?.selectedRange;
    if (range && typeof range.start === 'number' && typeof range.end === 'number') {
      return Math.max(0, range.end - range.start + 1);
    }
    const images = Array.isArray(file?.pageImageKeys) ? file.pageImageKeys.length : 0;
    return images;
  }

  private computeVisionPageCap(totalPages: number): number {
    if (!totalPages) {
      return 0;
    }
    return Math.ceil(totalPages / 15) * 5;
  }

  private async processFeature(
    job: StudySetAiJobDocument,
    file: any,
    feature: string,
    studySource: string
  ): Promise<{ result: unknown; usage: TokenUsage }> {
    const supportedFeatures = ['summary', 'flashcards', 'quizzes'];
    if (!supportedFeatures.includes(feature)) {
      throw new Error(`Unsupported feature ${feature}`);
    }

    try {
      this.logger.log(`Processing ${feature} for file ${file.fileName}`);
      if (feature === 'summary') {
        const response = await this.summariesService.generateStructuredSummary(studySource, file.fileName);
        return this.splitUsage(response);
      }

      if (feature === 'flashcards') {
        const response = await this.flashcardsService.generateFlashcards(
          studySource,
          file.fileName,
          job.studySet.toString(),
          file.fileId
        );
        return this.splitUsage(response);
      }

      if (feature === 'quizzes') {
        const response = await this.quizzesService.generateQuiz(studySource, file.fileName);
        return this.splitUsage(response);
      }
      this.logger.log(`Completed ${feature} for ${file.fileName}`);
      return { result: null, usage: this.emptyUsage() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed ${feature} for ${file.fileName}: ${message}`);
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
