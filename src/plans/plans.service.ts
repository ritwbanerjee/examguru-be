import { Injectable } from '@nestjs/common';
import { CurrencyCode, PLAN_DEFINITIONS, PlanDefinition, PlanId } from './plan-config';

export interface PlanPrice {
  amount: number;
  currency: CurrencyCode;
  period: 'month' | 'lifetime';
}

export interface PlanResponse {
  id: string;
  name: string;
  price: PlanPrice;
  limits: PlanDefinition['limits'];
  features: string[];
}

export interface PlansResponse {
  currency: CurrencyCode;
  plans: PlanResponse[];
}

@Injectable()
export class PlansService {
  resolveCurrency(preferred?: string, acceptLanguage?: string): CurrencyCode {
    const normalized = preferred?.toUpperCase();
    if (normalized === 'INR' || normalized === 'EUR') {
      return normalized as CurrencyCode;
    }
    const locale = (acceptLanguage ?? '').toLowerCase();
    if (locale.includes('hi') || locale.includes('en-in') || locale.includes('-in')) {
      return 'INR';
    }
    return 'EUR';
  }

  getPlans(currency: CurrencyCode): PlansResponse {
    const plans = PLAN_DEFINITIONS.map(plan => this.formatPlan(plan, currency));
    return { currency, plans };
  }

  getPlanDefinition(planId?: string | null): PlanDefinition {
    const normalized = (planId ?? 'free').toLowerCase();
    const mapped = this.mapLegacyPlan(normalized);
    return PLAN_DEFINITIONS.find(plan => plan.id === mapped) ?? PLAN_DEFINITIONS[0];
  }

  getUpgradePlan(planId?: string | null): PlanDefinition | null {
    const current = this.getPlanDefinition(planId);
    const index = PLAN_DEFINITIONS.findIndex(plan => plan.id === current.id);
    if (index < 0 || index >= PLAN_DEFINITIONS.length - 1) {
      return null;
    }
    return PLAN_DEFINITIONS[index + 1] ?? null;
  }

  private mapLegacyPlan(planId: string): PlanId {
    switch (planId) {
      case 'student_lite':
        return 'student_lite';
      case 'student_pro':
        return 'student_pro';
      case 'pro_plus':
        return 'pro_plus';
      case 'pro':
        return 'student_pro';
      case 'premium':
        return 'pro_plus';
      default:
        return 'free';
    }
  }

  private formatPlan(plan: PlanDefinition, preferredCurrency: CurrencyCode): PlanResponse {
    const priceCurrency = plan.prices[preferredCurrency] !== undefined ? preferredCurrency : 'EUR';
    const amount = plan.prices[priceCurrency] ?? 0;
    return {
      id: plan.id,
      name: plan.name,
      price: {
        amount,
        currency: priceCurrency,
        period: plan.period
      },
      limits: plan.limits,
      features: plan.features
    };
  }
}
