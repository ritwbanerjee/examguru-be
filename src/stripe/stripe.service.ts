import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { UsersService } from '../users/users.service';
import { PLAN_DEFINITIONS, PlanId } from '../plans/plan-config';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover',
    });
  }

  /**
   * Create a Stripe Checkout Session for subscription
   */
  async createCheckoutSession(
    userId: string,
    planId: PlanId,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ sessionId: string; url: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (planId === 'free') {
      throw new BadRequestException('Cannot create checkout for free plan');
    }

    const plan = PLAN_DEFINITIONS.find(p => p.id === planId);
    if (!plan) {
      throw new BadRequestException('Invalid plan');
    }

    // Get Stripe Price ID from ConfigService (loaded from .env)
    const stripePriceId = this.getStripePriceId(planId);
    if (!stripePriceId) {
      throw new BadRequestException(`Missing Stripe Price ID for plan: ${planId}`);
    }

    // Create or retrieve Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;
      await this.usersService.updateStripeCustomerId(userId, customerId);
    }

    // Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      metadata: {
        userId: userId,
        planId: planId,
      },
    });

    return {
      sessionId: session.id,
      url: session.url!,
    };
  }

  /**
   * Get Stripe Price ID for a plan from environment variables
   */
  private getStripePriceId(planId: PlanId): string | null {
    switch (planId) {
      case 'student_lite':
        return this.configService.get<string>('STRIPE_PRICE_STUDENT_LITE') || null;
      case 'student_pro':
        return this.configService.get<string>('STRIPE_PRICE_STUDENT_PRO') || null;
      case 'pro_plus':
        return this.configService.get<string>('STRIPE_PRICE_PRO_PLUS') || null;
      default:
        return null;
    }
  }

  /**
   * Create a Customer Portal Session for subscription management
   */
  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.stripe_customer_id) {
      throw new BadRequestException('No active subscription found');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  /**
   * Cancel subscription and delete customer when user deletes account
   */
  async cancelSubscriptionOnAccountDeletion(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Cancel active subscription immediately
    if (user.stripe_subscription_id) {
      try {
        await this.stripe.subscriptions.cancel(user.stripe_subscription_id);
        this.logger.log(`Cancelled subscription ${user.stripe_subscription_id} for deleted user ${userId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to cancel subscription: ${errorMessage}`);
      }
    }

    // Delete Stripe customer
    if (user.stripe_customer_id) {
      try {
        await this.stripe.customers.del(user.stripe_customer_id);
        this.logger.log(`Deleted Stripe customer ${user.stripe_customer_id} for deleted user ${userId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to delete Stripe customer: ${errorMessage}`);
      }
    }
  }

  /**
   * Change subscription plan
   * - Upgrade: immediate with proration
   * - Downgrade: scheduled at period end
   * - Cancel to free: scheduled at period end
   */
  async changeSubscription(
    userId: string,
    newPlanId: PlanId,
  ): Promise<{ success: boolean; message: string; invoiceUrl?: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const currentPlanId = (user.plan || 'free') as PlanId;

    // Check if user is already on this plan
    if (currentPlanId === newPlanId) {
      return {
        success: true,
        message: 'You are already on this plan.',
      };
    }

    // Handle cancellation to free tier
    if (newPlanId === 'free') {
      return await this.cancelToFreeTier(userId, user);
    }

    // Get new price ID
    const newPriceId = this.getStripePriceId(newPlanId);
    if (!newPriceId) {
      throw new BadRequestException(`Missing Stripe Price ID for plan: ${newPlanId}`);
    }

    // If user doesn't have an active subscription, create a new checkout session
    if (!user.stripe_subscription_id || user.subscription_status !== 'active') {
      throw new BadRequestException('No active subscription to modify. Please create a new subscription.');
    }

    // Verify subscription exists in Stripe before attempting to modify
    try {
      const existingSubscription = await this.stripe.subscriptions.retrieve(user.stripe_subscription_id);
      if (existingSubscription.status === 'canceled') {
        throw new BadRequestException('Your subscription has been canceled. Please create a new subscription.');
      }
    } catch (error) {
      if ((error as any).code === 'resource_missing') {
        // Subscription doesn't exist in Stripe, clean up database
        await this.usersService.updateSubscription(userId, {
          plan: 'free',
          subscription_status: 'inactive',
          stripe_subscription_id: null,
          subscription_current_period_start: null,
          subscription_current_period_end: null,
          cancel_at_period_end: false,
        });
        throw new BadRequestException('Subscription not found. Please create a new subscription.');
      }
      throw error;
    }

    // Determine if this is an upgrade or downgrade
    const isUpgrade = this.isUpgrade(currentPlanId, newPlanId);

    try {
      const subscription = await this.stripe.subscriptions.retrieve(user.stripe_subscription_id);
      const currentItemId = subscription.items.data[0].id;

      if (isUpgrade) {
        // Upgrade: immediate change with proration
        // Clear cancel_at_period_end if it was set (user changed their mind)
        const updatedSubscription = await this.stripe.subscriptions.update(user.stripe_subscription_id, {
          items: [
            {
              id: currentItemId,
              price: newPriceId,
            },
          ],
          proration_behavior: 'create_prorations',
          payment_behavior: 'error_if_incomplete',
          cancel_at_period_end: false,
        });

        // Check if there's a pending invoice that needs payment
        if (updatedSubscription.status === 'incomplete' || updatedSubscription.status === 'past_due') {
          this.logger.warn(`Upgrade created pending invoice for user ${userId}`);

          // Get the latest invoice
          const latestInvoiceId = updatedSubscription.latest_invoice as string;
          if (latestInvoiceId) {
            const invoice = await this.stripe.invoices.retrieve(latestInvoiceId);

            if (invoice.hosted_invoice_url) {
              return {
                success: false,
                message: 'Payment required to complete upgrade.',
                invoiceUrl: invoice.hosted_invoice_url,
              };
            }
          }

          throw new BadRequestException('Unable to process payment. Please update your payment method.');
        }

        this.logger.log(`Upgraded user ${userId} from ${currentPlanId} to ${newPlanId} immediately`);
        return {
          success: true,
          message: 'Your plan has been upgraded immediately. You will be charged a prorated amount.',
        };
      } else {
        // Downgrade: schedule change at period end using schedule
        const currentPeriodEnd = (subscription as any).current_period_end;

        // Update subscription to downgrade at period end
        // Clear cancel_at_period_end if it was set (user is changing plan, not canceling)
        await this.stripe.subscriptions.update(user.stripe_subscription_id, {
          items: [
            {
              id: currentItemId,
              price: newPriceId,
            },
          ],
          proration_behavior: 'none',
          billing_cycle_anchor: 'unchanged',
          cancel_at_period_end: false,
        });

        this.logger.log(`Scheduled downgrade for user ${userId} from ${currentPlanId} to ${newPlanId} at period end (${new Date(currentPeriodEnd * 1000)})`);
        return {
          success: true,
          message: 'Your plan will be downgraded at the end of your current billing period.',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to change subscription: ${errorMessage}`);
      throw new BadRequestException('Failed to change subscription plan');
    }
  }

  /**
   * Cancel subscription to free tier (at period end)
   */
  private async cancelToFreeTier(
    userId: string,
    user: any,
  ): Promise<{ success: boolean; message: string }> {
    if (!user.stripe_subscription_id) {
      // Already on free tier
      return {
        success: true,
        message: 'You are already on the free tier.',
      };
    }

    try {
      // Cancel subscription at period end
      await this.stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at_period_end: true,
      });

      // Update user in database
      await this.usersService.updateSubscription(userId, {
        plan: user.plan,
        subscription_status: user.subscription_status,
        stripe_subscription_id: user.stripe_subscription_id,
        subscription_current_period_start: user.subscription_current_period_start,
        subscription_current_period_end: user.subscription_current_period_end,
        cancel_at_period_end: true,
      });

      this.logger.log(`Scheduled cancellation to free tier for user ${userId} at period end`);
      return {
        success: true,
        message: 'Your subscription will be cancelled at the end of your current billing period. You will be moved to the free tier.',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to cancel subscription: ${errorMessage}`);
      throw new BadRequestException('Failed to cancel subscription');
    }
  }

  /**
   * Determine if changing from currentPlan to newPlan is an upgrade
   * Based on price comparison
   */
  private isUpgrade(currentPlanId: PlanId, newPlanId: PlanId): boolean {
    const planPriority: Record<PlanId, number> = {
      free: 0,
      student_lite: 1,
      student_pro: 2,
      pro_plus: 3,
    };

    return planPriority[newPlanId] > planPriority[currentPlanId];
  }

  /**
   * Get subscription details including invoices
   */
  async getSubscriptionDetails(userId: string): Promise<{
    subscriptionId: string;
    plan: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    invoices: Array<{
      id: string;
      number: string | null;
      amount: number;
      currency: string;
      status: string;
      created: string;
      invoiceUrl: string;
      invoicePdf: string;
    }>;
  }> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.stripe_subscription_id) {
      throw new BadRequestException('No active subscription found');
    }

    // Get subscription details with expanded data including items and their prices
    const subscription = await this.stripe.subscriptions.retrieve(user.stripe_subscription_id, {
      expand: ['latest_invoice', 'items.data.price'],
    });
    this.logger.log(`Retrieved subscription ${subscription.id} for user ${userId}, status: ${subscription.status}`);

    // Get customer's invoices
    const invoicesList = await this.stripe.invoices.list({
      customer: user.stripe_customer_id,
      limit: 10,
    });

    const invoices = invoicesList.data.map(invoice => ({
      id: invoice.id,
      number: invoice.number,
      amount: invoice.amount_paid || invoice.amount_due,
      currency: invoice.currency,
      status: invoice.status || 'unknown',
      created: new Date(invoice.created * 1000).toISOString(),
      invoiceUrl: invoice.hosted_invoice_url || '',
      invoicePdf: invoice.invoice_pdf || '',
    }));

    // Extract period dates from subscription
    // Check the items array for period information
    const subData = subscription as any;

    // Log the structure to understand what we're working with
    this.logger.log(`Subscription items count: ${subData.items?.data?.length || 0}`);
    if (subData.items?.data?.[0]) {
      this.logger.log(`First item keys: ${Object.keys(subData.items.data[0]).join(', ')}`);
    }

    // Try to get period from the subscription items or calculate from billing cycle
    let currentPeriodStart = subData.current_period_start;
    let currentPeriodEnd = subData.current_period_end;

    // If not found, check items
    if (!currentPeriodStart && subData.items?.data?.[0]) {
      const item = subData.items.data[0];
      currentPeriodStart = item.current_period_start;
      currentPeriodEnd = item.current_period_end;
    }

    // If still not found, use billing_cycle_anchor and calculate
    if (!currentPeriodStart) {
      currentPeriodStart = subData.billing_cycle_anchor || subData.start_date;
      // Calculate next period based on the plan interval
      if (currentPeriodStart && subData.items?.data?.[0]?.price?.recurring) {
        const interval = subData.items.data[0].price.recurring.interval;
        const intervalCount = subData.items.data[0].price.recurring.interval_count || 1;
        const startDate = new Date(currentPeriodStart * 1000);
        const endDate = new Date(startDate);

        if (interval === 'month') {
          endDate.setMonth(endDate.getMonth() + intervalCount);
        } else if (interval === 'year') {
          endDate.setFullYear(endDate.getFullYear() + intervalCount);
        }

        currentPeriodEnd = Math.floor(endDate.getTime() / 1000);
      }
    }

    const cancelAtPeriodEnd = subData.cancel_at_period_end;

    this.logger.log(`Subscription periods: start=${currentPeriodStart}, end=${currentPeriodEnd}, cancel_at_period_end=${cancelAtPeriodEnd}`);

    if (!currentPeriodStart || !currentPeriodEnd) {
      this.logger.error(`Missing period info for subscription ${subscription.id}`);
      throw new BadRequestException('Subscription period information is missing');
    }

    return {
      subscriptionId: subscription.id,
      plan: user.plan || 'free',
      status: subscription.status,
      currentPeriodStart: new Date(currentPeriodStart * 1000).toISOString(),
      currentPeriodEnd: new Date(currentPeriodEnd * 1000).toISOString(),
      cancelAtPeriodEnd: cancelAtPeriodEnd || false,
      invoices,
    };
  }

  /**
   * Cancel subscription (will be cancelled at period end)
   */
  async cancelSubscription(userId: string): Promise<{ success: boolean; message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.stripe_subscription_id) {
      throw new BadRequestException('No active subscription found');
    }

    try {
      // Cancel subscription at period end
      await this.stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at_period_end: true,
      });

      // Update user in database
      await this.usersService.updateSubscription(userId, {
        plan: user.plan || 'free',
        subscription_status: user.subscription_status || 'active',
        stripe_subscription_id: user.stripe_subscription_id || null,
        subscription_current_period_start: user.subscription_current_period_start || null,
        subscription_current_period_end: user.subscription_current_period_end || null,
        cancel_at_period_end: true,
      });

      this.logger.log(`Scheduled cancellation for user ${userId} at period end`);
      return {
        success: true,
        message: `Your subscription will be cancelled on ${new Date(user.subscription_current_period_end || '').toLocaleDateString()}. You will continue to have access until then.`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to cancel subscription: ${errorMessage}`);
      throw new BadRequestException('Failed to cancel subscription');
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(
    signature: string,
    rawBody: Buffer,
  ): Promise<{ received: boolean }> {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Webhook signature verification failed: ${errorMessage}`);
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(`Processing webhook event: ${event.type} [${event.id}]`);

    // TODO: Implement idempotency key storage to prevent duplicate webhook processing
    // For production, store event.id in database and check if already processed

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error processing webhook: ${errorMessage}`, errorStack);
      throw error;
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    const planId = session.metadata?.planId as PlanId;

    if (!userId || !planId) {
      this.logger.error('Missing metadata in checkout session');
      return;
    }

    this.logger.log(`Checkout completed for user ${userId}, plan ${planId}`);

    // Subscription will be handled by subscription.created event
    // This just logs the checkout completion
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const user = await this.usersService.findByStripeCustomerId(customerId);

    if (!user) {
      this.logger.error(`User not found for Stripe customer ${customerId}`);
      return;
    }

    // Map Stripe price ID to our plan ID
    const priceId = subscription.items.data[0]?.price.id;
    const planId = this.getPlanIdFromPriceId(priceId);

    const subscriptionData = {
      plan: planId,
      subscription_status: subscription.status,
      stripe_subscription_id: subscription.id,
      subscription_current_period_start: new Date((subscription as any).current_period_start * 1000),
      subscription_current_period_end: new Date((subscription as any).current_period_end * 1000),
      cancel_at_period_end: (subscription as any).cancel_at_period_end || false,
    };

    await this.usersService.updateSubscription(user._id.toString(), subscriptionData);

    this.logger.log(
      `Updated subscription for user ${user._id}: plan=${planId}, status=${subscription.status}`,
    );
  }

  /**
   * Map Stripe Price ID back to our Plan ID
   */
  private getPlanIdFromPriceId(priceId: string | undefined): PlanId {
    if (!priceId) return 'free';

    const studentLitePrice = this.configService.get<string>('STRIPE_PRICE_STUDENT_LITE');
    const studentProPrice = this.configService.get<string>('STRIPE_PRICE_STUDENT_PRO');
    const proPlusPrice = this.configService.get<string>('STRIPE_PRICE_PRO_PLUS');

    if (priceId === studentLitePrice) return 'student_lite';
    if (priceId === studentProPrice) return 'student_pro';
    if (priceId === proPlusPrice) return 'pro_plus';

    return 'free';
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const user = await this.usersService.findByStripeCustomerId(customerId);

    if (!user) {
      this.logger.error(`User not found for Stripe customer ${customerId}`);
      return;
    }

    await this.usersService.updateSubscription(user._id.toString(), {
      plan: 'free',
      subscription_status: 'canceled',
      stripe_subscription_id: null,
      subscription_current_period_start: null,
      subscription_current_period_end: null,
      cancel_at_period_end: false,
    });

    this.logger.log(`Subscription deleted for user ${user._id}, reverted to free plan`);
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const user = await this.usersService.findByStripeCustomerId(customerId);

    if (!user) {
      this.logger.error(`User not found for Stripe customer ${customerId}`);
      return;
    }

    // Update subscription status to active on successful payment
    await this.usersService.updateSubscriptionStatus(user._id.toString(), 'active');

    this.logger.log(`Invoice payment succeeded for user ${user._id}`);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const user = await this.usersService.findByStripeCustomerId(customerId);

    if (!user) {
      this.logger.error(`User not found for Stripe customer ${customerId}`);
      return;
    }

    // Update subscription status to past_due
    await this.usersService.updateSubscriptionStatus(user._id.toString(), 'past_due');

    this.logger.log(`Invoice payment failed for user ${user._id}`);
  }
}
