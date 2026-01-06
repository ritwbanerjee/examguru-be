import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Headers,
  RawBodyRequest,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlanId } from '../plans/plan-config';

class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  planId!: PlanId;
}

class CreatePortalSessionDto {
  @IsString()
  @IsOptional()
  returnUrl?: string;
}

class ChangeSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  planId!: PlanId;
}

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create-checkout-session')
  async createCheckoutSession(
    @Req() req: any,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    const userId = req.user.id;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

    const successUrl = `${frontendUrl}/app/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/app/pricing`;

    const session = await this.stripeService.createCheckoutSession(
      userId,
      dto.planId,
      successUrl,
      cancelUrl,
    );

    return session;
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-portal-session')
  async createPortalSession(
    @Req() req: any,
    @Body() dto: CreatePortalSessionDto,
  ) {
    const userId = req.user.id;
    const returnUrl = dto.returnUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:4200';

    const session = await this.stripeService.createPortalSession(userId, returnUrl);

    return session;
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-subscription')
  async changeSubscription(
    @Req() req: any,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    const userId = req.user.id;
    return this.stripeService.changeSubscription(userId, dto.planId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscription-details')
  async getSubscriptionDetails(@Req() req: any) {
    const userId = req.user.id;
    return this.stripeService.getSubscriptionDetails(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cancel-subscription')
  async cancelSubscription(@Req() req: any) {
    const userId = req.user.id;
    return this.stripeService.cancelSubscription(userId);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new Error('Missing raw body for webhook verification');
    }

    return this.stripeService.handleWebhook(signature, rawBody);
  }
}
