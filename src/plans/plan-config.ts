export type PlanId = 'free' | 'student_lite' | 'student_pro' | 'pro_plus';
export type CurrencyCode = 'EUR' | 'INR';
export type BillingPeriod = 'month' | 'lifetime';

export interface PlanLimits {
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

export interface PlanDefinition {
  id: PlanId;
  name: string;
  period: BillingPeriod;
  prices: Partial<Record<CurrencyCode, number>>;
  limits: PlanLimits;
  features: string[];
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    period: 'lifetime',
    prices: { EUR: 0, INR: 0 },
    limits: {
      pagesPerMonth: 5,
      runsPerMonth: 'lifetime',
      dailyRuns: 1,
      concurrency: 1,
      ocrPagesPerMonth: 1,
      visionMultiplier: 'disabled',
      maxPagesPerRun: 5,
      studySets: 1,
      regeneration: false
    },
    features: [
      'Sample insight (2-3 sentences)',
      'Document structure preview',
      'Locked chapter map'
    ]
  },
  {
    id: 'student_lite',
    name: 'Student Lite',
    period: 'month',
    prices: { EUR: 3.99, INR: 199 },
    limits: {
      pagesPerMonth: 60,
      runsPerMonth: 20,
      dailyRuns: 3,
      concurrency: 1,
      ocrPagesPerMonth: 10,
      visionMultiplier: 'disabled',
      maxPagesPerRun: 15,
      studySets: 5,
      regeneration: false
    },
    features: [
      'Full summaries',
      'Basic flashcards',
      'Limited quizzes',
      'Chapter auto-splitting'
    ]
  },
  {
    id: 'student_pro',
    name: 'Student Pro',
    period: 'month',
    prices: { EUR: 7.99, INR: 499 },
    limits: {
      pagesPerMonth: 200,
      runsPerMonth: 60,
      dailyRuns: 6,
      concurrency: 2,
      ocrPagesPerMonth: 30,
      visionMultiplier: 'disabled',
      maxPagesPerRun: 15,
      studySets: 'unlimited',
      regeneration: true
    },
    features: [
      'Better summaries',
      'More flashcards',
      'Most likely exam questions',
      'Priority queue'
    ]
  },
  {
    id: 'pro_plus',
    name: 'Pro+',
    period: 'month',
    prices: { EUR: 9 },
    limits: {
      pagesPerMonth: 350,
      runsPerMonth: 120,
      dailyRuns: 10,
      concurrency: 4,
      ocrPagesPerMonth: 70,
      visionMultiplier: 1,
      maxPagesPerRun: 25,
      studySets: 'unlimited',
      regeneration: true
    },
    features: [
      'Best summaries',
      'Expanded flashcards',
      'Deeper quizzes',
      'Priority queue',
      'Faster processing'
    ]
  }
];
