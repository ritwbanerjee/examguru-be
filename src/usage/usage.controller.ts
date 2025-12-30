import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsageService } from './usage.service';

interface UsageLedgerResponse {
  year: number;
  month: number;
  runsUsed: number;
  pagesProcessed: number;
  ocrPagesProcessed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

@ApiTags('Usage')
@ApiBearerAuth('bearer')
@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

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
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens
    }));
  }
}
