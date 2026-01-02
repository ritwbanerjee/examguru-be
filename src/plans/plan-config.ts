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
  aiFeatures: {
    summary: boolean;
    flashcards: boolean;
    quizzes: boolean;
  };
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
      'Create 1 study set to try it out',
      'Process up to 5 pages of study material',
      'AI-powered summaries of your content',
      'Extract key insights automatically',
      'Identify important concepts',
      '1 daily generation to get started'
    ],
    aiFeatures: {
      summary: true,
      flashcards: false,
      quizzes: false
    }
  },
  {
    id: 'student_lite',
    name: 'Student Lite',
    period: 'month',
    prices: { EUR: 3.99 },
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
      'Create up to 5 study sets per month',
      'Process 60 pages of notes and textbooks',
      '20 AI generations monthly (3 per day)',
      'Up to 15 pages per study session',
      'Comprehensive AI summaries',
      'Auto-generated flashcards for memorization',
      'Practice quizzes to test yourself',
      'Scan and extract text from images (10/month)',
      'Perfect for light studiers'
    ],
    aiFeatures: {
      summary: true,
      flashcards: true,
      quizzes: true
    }
  },
  {
    id: 'student_pro',
    name: 'Student Pro',
    period: 'month',
    prices: { EUR: 7.99 },
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
      'Unlimited study sets - organize all your subjects',
      'Process 200 pages monthly (perfect for heavy studiers)',
      '60 AI generations per month (6 daily)',
      'Up to 15 pages per study session',
      'Process 2 documents simultaneously',
      'Advanced flashcards with study & review modes',
      'Interactive quizzes with progress tracking',
      'Re-generate content until it\'s perfect',
      'Scan handwritten notes (30 OCR runs/month)',
      'Most popular for serious students'
    ],
    aiFeatures: {
      summary: true,
      flashcards: true,
      quizzes: true
    }
  },
  {
    id: 'pro_plus',
    name: 'Pro+',
    period: 'month',
    prices: { EUR: 9.99 },
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
      'Unlimited study sets for all your courses',
      'Process 350 pages monthly - power through exams',
      '120 AI generations per month (10 daily)',
      'Process up to 25 pages in one go',
      'Work on 4 documents at the same time',
      'Flashcards with self-assessment analytics',
      'Quiz mode with detailed progress tracking',
      'Regenerate unlimited times for perfect results',
      'OCR for handwritten notes (70 scans/month)',
      'Vision AI for diagrams and complex images',
      'Best for graduate students & heavy users'
    ],
    aiFeatures: {
      summary: true,
      flashcards: true,
      quizzes: true
    }
  }
];
