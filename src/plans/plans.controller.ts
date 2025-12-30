import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlansService, PlansResponse } from './plans.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { DevPlanUpgradeDto } from './dto/dev-plan-upgrade.dto';
import { Request } from 'express';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService
  ) {}

  @Get()
  getPlans(
    @Query('currency') currency?: string,
    @Headers('accept-language') acceptLanguage?: string
  ): PlansResponse {
    const resolvedCurrency = this.plansService.resolveCurrency(currency, acceptLanguage);
    return this.plansService.getPlans(resolvedCurrency);
  }

  @Post('dev/upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Dev-only plan upgrade (no payment)' })
  @ApiResponse({ status: 200, description: 'Plan updated (dev only).' })
  async devUpgrade(
    @Body() dto: DevPlanUpgradeDto,
    @Req() req: Request & { user: { id: string } }
  ): Promise<{ user: Awaited<ReturnType<AuthService['getProfile']>> }> {
    const allowOverride =
      process.env.DEV_ALLOW_PLAN_OVERRIDE === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowOverride) {
      throw new ForbiddenException('Plan overrides are disabled.');
    }

    const requested = dto.planId?.toLowerCase();
    const planMap: Record<string, string> = {
      free: 'free',
      student_lite: 'student_lite',
      student_pro: 'student_pro',
      pro_plus: 'pro_plus',
      pro: 'student_pro',
      premium: 'pro_plus'
    };
    const mapped = planMap[requested ?? ''];
    if (!mapped) {
      throw new BadRequestException('Unknown plan.');
    }

    const plan = this.plansService.getPlanDefinition(mapped);
    const subscriptionStatus = plan.id === 'free' ? 'inactive' : 'active';

    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not found.');
    }
    await this.usersService.updatePlan(userId, plan.id, subscriptionStatus);
    return { user: await this.authService.getProfile({ id: userId }) };
  }
}
