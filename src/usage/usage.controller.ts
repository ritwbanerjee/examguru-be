import { Controller, Get, NotFoundException, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlansService } from '../plans/plans.service';
import { UsersService } from '../users/users.service';
import { UsageService } from './usage.service';

interface UsageLedgerResponse {
  year: number;
  month: number;
  runsUsed: number;
  pagesProcessed: number;
  ocrPagesProcessed: number;
  visionImagesProcessed: number;
  visionUnitsProcessed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface UsageSummaryLimits {
  pagesPerMonth: number;
  runsPerMonth: number | 'lifetime';
  dailyRuns: number;
  concurrency: number;
  ocrPagesPerMonth: number;
  visionMultiplier: number | 'disabled';
  maxPagesPerRun: number;
  studySets: number | 'unlimited';
  regeneration: boolean;
}

interface UsageSummaryResponse {
  plan: { id: string; name: string };
  limits: UsageSummaryLimits;
  usage: UsageLedgerResponse;
  dailyRunsUsed: number;
  activeJobs: number;
  studySetsCount: number;
}

@ApiTags('Usage')
@ApiBearerAuth('bearer')
@Controller('usage')
export class UsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly plansService: PlansService,
    private readonly usersService: UsersService
  ) {}

  @Get('ledger')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get monthly usage ledger',
    description: 'Returns recent monthly usage summaries for the authenticated user.'
  })
  @ApiOkResponse({
    description: 'Monthly usage ledger',
    isArray: true
  })
  async getLedger(
    @Req() req: Request & { user: { id: string } },
    @Query('limit') limit?: string
  ): Promise<UsageLedgerResponse[]> {
    const resolvedLimit = limit ? Number(limit) : 12;
    const ledgers = await this.usageService.getUserLedgers(
      new Types.ObjectId(req.user.id),
      Number.isFinite(resolvedLimit) ? resolvedLimit : 12
    );
    return ledgers.map(item => ({
      year: item.year,
      month: item.month,
      runsUsed: item.runsUsed,
      pagesProcessed: item.pagesProcessed,
      ocrPagesProcessed: item.ocrPagesProcessed,
      visionImagesProcessed: item.visionImagesProcessed,
      visionUnitsProcessed: item.visionUnitsProcessed,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens
    }));
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get usage summary with plan limits',
    description: 'Returns current plan limits and usage totals for the authenticated user.'
  })
  @ApiOkResponse({
    description: 'Usage summary'
  })
  async getSummary(
    @Req() req: Request & { user: { id: string } }
  ): Promise<UsageSummaryResponse> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const plan = this.plansService.getPlanDefinition(user.plan);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const ledger = await this.usageService.getMonthlyLedger(user._id, year, month);

    const usage: UsageLedgerResponse = {
      year,
      month,
      runsUsed: ledger?.runsUsed ?? 0,
      pagesProcessed: ledger?.pagesProcessed ?? 0,
      ocrPagesProcessed: ledger?.ocrPagesProcessed ?? 0,
      visionImagesProcessed: ledger?.visionImagesProcessed ?? 0,
      visionUnitsProcessed: ledger?.visionUnitsProcessed ?? 0,
      inputTokens: ledger?.inputTokens ?? 0,
      outputTokens: ledger?.outputTokens ?? 0,
      totalTokens: ledger?.totalTokens ?? 0
    };

    const [dailyRunsUsed, activeJobs, studySetsCount] = await Promise.all([
      this.usageService.countDailyRuns(user._id, now),
      this.usageService.countActiveJobs(user._id),
      this.usageService.countStudySets(user._id)
    ]);

    return {
      plan: { id: plan.id, name: plan.name },
      limits: plan.limits,
      usage,
      dailyRunsUsed,
      activeJobs,
      studySetsCount
    };
  }
}
