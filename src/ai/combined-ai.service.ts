import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { SummariesService, StructuredSummary } from '../summaries/summaries.service';
import { FlashcardsService, Flashcard } from '../flashcards/flashcards.service';
import { QuizzesService, QuizQuestion } from '../quizzes/quizzes.service';

export interface CombinedAIResponse {
  summary: StructuredSummary;
  flashcards: Flashcard[];
  quizzes: QuizQuestion[];
}

export interface GeneratedCombinedResponse {
  model: string;
  promptVersion: string;
  data: CombinedAIResponse;
  rawResponse: unknown;
}

@Injectable()
export class CombinedAIService {
  private readonly logger = new Logger(CombinedAIService.name);
  private readonly openai: OpenAI;
  private readonly model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  private readonly promptVersion = 'v2-combined';
  private readonly minFlashcards = 20;
  private readonly minQuizzes = 12;

  constructor(
    private readonly summariesService: SummariesService,
    private readonly flashcardsService: FlashcardsService,
    private readonly quizzesService: QuizzesService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generateAll(
    content: string,
    topic?: string,
  ): Promise<GeneratedCombinedResponse> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot generate content from empty text.');
    }

    const prompt = this.buildCombinedPrompt(trimmedContent, topic);
    const systemPrompt = 'You are a JSON-only assistant. You respond ONLY with valid JSON objects. Never include explanatory text, markdown, or any other content outside the JSON structure.';

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 8000, // Increased for combined output with 20+ items each
      });

      const llmText = response.choices[0]?.message?.content?.trim();
      if (!llmText) {
        this.logger.error('Received empty response from OpenAI.');
        throw new InternalServerErrorException('LLM returned an empty response.');
      }

      this.logger.log('OpenAI Response (Combined):', llmText);

      const parsedData = this.parseCombinedResponse(llmText);

      // Fallback: Retry individual sections if they failed
      const finalData = await this.retryFailedSections(parsedData, content, topic);

      return {
        model: response.model ?? this.model,
        promptVersion: this.promptVersion,
        data: finalData,
        rawResponse: this.tryParseRaw(llmText),
      };
    } catch (error) {
      this.logger.error('Combined OpenAI request failed:', error);
      this.logger.warn('Falling back to individual service calls...');

      // Complete fallback: use individual services
      return this.fallbackToIndividualServices(content, topic);
    }
  }

  private buildCombinedPrompt(content: string, topic: string | undefined): string {
    const exampleOutput = {
      summary: {
        title: 'Introduction to Photosynthesis',
        summary: 'Photosynthesis is the process by which plants convert light energy into chemical energy.',
        detailed_summary: 'Photosynthesis is a fundamental biological process where plants, algae, and certain bacteria convert light energy into chemical energy stored in glucose molecules. This process occurs primarily in the chloroplasts of plant cells and involves two main stages: the light-dependent reactions and the Calvin cycle (light-independent reactions). During the light-dependent reactions, chlorophyll and other pigments absorb light energy, which is used to split water molecules, releasing oxygen as a byproduct and generating ATP and NADPH. These energy carriers then fuel the Calvin cycle, where carbon dioxide from the atmosphere is fixed into organic molecules, ultimately producing glucose.',
        key_points: [
          {
            heading: 'Light-dependent reactions',
            detail: 'Occur in thylakoid membranes where light energy is captured.'
          },
          {
            heading: 'Calvin cycle',
            detail: 'Takes place in the stroma where CO2 is fixed into glucose.'
          }
        ],
        study_recommendations: [
          'Draw diagrams of both light and dark reactions',
          'Memorize the overall equation'
        ],
        confidence: 'high'
      },
      flashcards: [
        {
          prompt: 'What is the primary function of mitochondria?',
          answer: 'Mitochondria generate ATP through cellular respiration.',
          followUp: 'Review the electron transport chain',
          difficulty: 'intro'
        },
        {
          prompt: 'Explain aerobic vs anaerobic respiration',
          answer: 'Aerobic requires oxygen and produces ~38 ATP, anaerobic produces 2 ATP.',
          followUp: 'Practice drawing both pathways',
          difficulty: 'intermediate'
        }
      ],
      quizzes: [
        {
          question: 'What is the primary product of photosynthesis?',
          options: ['Carbon dioxide', 'Glucose', 'Water', 'Nitrogen'],
          correctIndex: 1,
          explanation: 'Photosynthesis converts CO2 and water into glucose using light energy.',
          difficulty: 'easy',
          topicTag: 'Photosynthesis Basics'
        },
        {
          question: 'Which stage occurs in the thylakoid membrane?',
          options: ['Calvin cycle', 'Glycolysis', 'Light-dependent reactions', 'Krebs cycle'],
          correctIndex: 2,
          explanation: 'Light-dependent reactions occur in the thylakoid membrane.',
          difficulty: 'medium',
          topicTag: 'Photosynthesis Stages'
        }
      ]
    };

    return [
      '=== STRICT JSON OUTPUT MODE ===',
      'You MUST output ONLY a valid JSON object. NO other text is allowed.',
      'DO NOT write: "Here is...", "It seems...", "To address...", "Based on...", "I can...", etc.',
      'DO NOT include <think> tags, reasoning, or explanations.',
      'DO NOT use markdown code fences like ```json.',
      'DO NOT create search queries or any other JSON structure.',
      '',
      'TASK: Generate a comprehensive, exam-grade study package with summary, flashcards, and quiz questions.',
      '',
      'You are an exam preparation assistant. Your outputs must help students pass exams.',
      'Scan the ENTIRE material. Do NOT focus only on introductory sections.',
      'Prioritize exam-relevant content: rules, procedures, definitions, thresholds, governance, eligibility.',
      '',
      '=== REQUIRED JSON STRUCTURE ===',
      'Your output must be a JSON object with these THREE EXACT top-level keys:',
      '',
      '1. summary (object):',
      '   - title (string): Descriptive title',
      '   - summary (string): 3-5 sentence overview',
      '   - detailed_summary (string): 600-900 word rich explanation covering ALL major content',
      '   - key_points (array of objects): Each with "heading" and "detail" fields (10-15 total)',
      '   - study_recommendations (array of strings): 6-8 actionable exam-prep tips',
      '   - confidence (string): Either "high", "medium", or "low"',
      '',
      '2. flashcards (array of objects):',
      '   - prompt (string): Exam-focused question',
      '   - answer (string): 1-2 sentences from source material',
      '   - followUp (string): Actionable, topic-specific reminder',
      '   - difficulty (string): Either "intro", "intermediate", or "advanced"',
      '',
      '3. quizzes (array of objects):',
      '   - question (string): The quiz question',
      '   - options (array of 4 strings): All plausible and distinct',
      '   - correctIndex (number): Zero-based index (0-3)',
      '   - explanation (string): Reference source material',
      '   - difficulty (string): Either "easy", "medium", or "hard"',
      '   - topicTag (string): Short, meaningful topic label',
      '',
      '=== EXAMPLE OUTPUT ===',
      JSON.stringify(exampleOutput, null, 2),
      '',
      '=== EXAM-GRADE GUIDELINES ===',
      '',
      'FOR SUMMARY:',
      '- Scan ENTIRE material, covering ALL major topics/sections proportionally',
      '- Prioritize exam-critical content: concepts, definitions, facts, processes',
      '- Study recommendations must be actionable and specific to this material',
      '- Match the academic level of the source material',
      '- Minimum output sizes are mandatory (10+ key_points, 6+ study_recommendations)',
      '',
      'FOR FLASHCARDS:',
      '- Generate at least 20 flashcards (more if the material supports it)',
      '- Generate as many flashcards as possible to ensure comprehensive coverage of ALL material',
      '- Create flashcards for EVERY major concept, definition, fact, formula, and process',
      '- There is NO limit - the more flashcards, the better for exam preparation',
      '- If the material is short, split concepts into granular cards without inventing facts',
      '- Cover: definitions, facts, concepts, formulas, relationships, processes',
      '- Answers must come from source material, not general knowledge',
      '- Include mix of intro, intermediate, and advanced difficulty',
      '- Adapt to the subject matter and grade level of the content',
      '',
      'FOR QUIZZES:',
      '- Generate at least 12 questions (more if the material supports it)',
      '- Generate as many questions as possible to ensure comprehensive coverage of ALL material',
      '- Create questions for EVERY major concept, definition, fact, procedure, and relationship',
      '- There is NO limit - the more questions, the better for exam preparation',
      '- If the material is short, split concepts into smaller questions without inventing facts',
      '- Test understanding through recall, application, and analysis',
      '- Prioritize: definitions, procedures, relationships, comparisons, facts, formulas',
      '- Ensure wide coverage across ALL topics (not just early sections)',
      '- Match the complexity and terminology of the source material',
      '',
      topic ? `Topic: ${topic}` : '',
      '',
      '=== SOURCE MATERIAL ===',
      content,
      '',
      '=== OUTPUT (JSON ONLY - START WITH { AND END WITH }) ==='
    ]
      .filter(Boolean)
      .join('\n');
  }

  private parseCombinedResponse(raw: string): CombinedAIResponse {
    const cleaned = this.cleanResponse(raw);

    try {
      const parsed = JSON.parse(cleaned);

      if (!parsed.summary || !parsed.flashcards || !parsed.quizzes) {
        this.logger.warn('Missing required sections in combined response');
        throw new Error('Incomplete combined response');
      }

      return {
        summary: parsed.summary,
        flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : [],
        quizzes: Array.isArray(parsed.quizzes) ? parsed.quizzes : [],
      };
    } catch (error) {
      this.logger.error('Failed to parse combined response:', error);
      throw error;
    }
  }

  private async retryFailedSections(
    data: CombinedAIResponse,
    content: string,
    topic?: string,
  ): Promise<CombinedAIResponse> {
    const retried = { ...data };

    // Retry summary if missing or invalid
    if (!data.summary || !data.summary.title || !data.summary.summary) {
      this.logger.warn('Summary section failed, retrying with individual service...');
      try {
        const summaryResponse = await this.summariesService.generateStructuredSummary(content, topic);
        retried.summary = summaryResponse.summary;
      } catch (error) {
        this.logger.error('Failed to retry summary:', error);
      }
    }

    // Retry flashcards if missing or undersized
    if (!data.flashcards || data.flashcards.length < this.minFlashcards) {
      const count = data.flashcards?.length ?? 0;
      this.logger.warn(
        `Flashcards section returned ${count}; retrying to reach ${this.minFlashcards}.`
      );
      try {
        const flashcardsResponse = await this.flashcardsService.generateFlashcards(content, topic);
        retried.flashcards = flashcardsResponse.flashcards;
      } catch (error) {
        this.logger.error('Failed to retry flashcards:', error);
      }
    }

    // Retry quizzes if missing or undersized
    if (!data.quizzes || data.quizzes.length < this.minQuizzes) {
      const count = data.quizzes?.length ?? 0;
      this.logger.warn(
        `Quizzes section returned ${count}; retrying to reach ${this.minQuizzes}.`
      );
      try {
        const quizzesResponse = await this.quizzesService.generateQuiz(content, topic);
        retried.quizzes = quizzesResponse.questions;
      } catch (error) {
        this.logger.error('Failed to retry quizzes:', error);
      }
    }

    return retried;
  }

  private async fallbackToIndividualServices(
    content: string,
    topic?: string,
  ): Promise<GeneratedCombinedResponse> {
    this.logger.log('Using complete fallback to individual services...');

    const [summaryResponse, flashcardsResponse, quizzesResponse] = await Promise.all([
      this.summariesService.generateStructuredSummary(content, topic).catch(err => {
        this.logger.error('Fallback summary failed:', err);
        return null;
      }),
      this.flashcardsService.generateFlashcards(content, topic).catch(err => {
        this.logger.error('Fallback flashcards failed:', err);
        return null;
      }),
      this.quizzesService.generateQuiz(content, topic).catch(err => {
        this.logger.error('Fallback quizzes failed:', err);
        return null;
      }),
    ]);

    return {
      model: this.model,
      promptVersion: `${this.promptVersion}-fallback`,
      data: {
        summary: summaryResponse?.summary ?? {
          title: 'Error',
          summary: 'Failed to generate summary',
          key_points: [],
          study_recommendations: [],
          confidence: 'low'
        },
        flashcards: flashcardsResponse?.flashcards ?? [],
        quizzes: quizzesResponse?.questions ?? [],
      },
      rawResponse: { fallback: true },
    };
  }

  private cleanResponse(raw: string): string {
    let cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json/gi, '')
      .replace(/```/g, '');

    cleaned = cleaned
      .replace(/^.*?(?:Here\s+(?:is|are)\s+(?:the|a)?)[^{[]*([{[])/i, '$1')
      .replace(/^.*?(?:It\s+seems)[^{[]*([{[])/i, '$1')
      .replace(/^.*?(?:To\s+address)[^{[]*([{[])/i, '$1')
      .replace(/^.*?(?:Based\s+on)[^{[]*([{[])/i, '$1')
      .replace(/^.*?(?:According\s+to)[^{[]*([{[])/i, '$1')
      .replace(/^.*?(?:Let\s+me)[^{[]*([{[])/i, '$1')
      .replace(/^.*?(?:I\s+(?:can|will|would|should))[^{[]*([{[])/i, '$1')
      .trim();

    return cleaned;
  }

  private tryParseRaw(raw: string): unknown {
    const cleaned = this.cleanResponse(raw);
    try {
      return JSON.parse(cleaned);
    } catch {
      return cleaned || raw;
    }
  }
}
