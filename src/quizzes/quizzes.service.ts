import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard' | string;
  topicTag?: string;
}

export interface GeneratedQuizResponse {
  model: string;
  promptVersion: string;
  questions: QuizQuestion[];
  rawResponse: unknown;
}

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger(QuizzesService.name);
  private readonly openai: OpenAI;
  private readonly model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  private readonly promptVersion = 'v3-quizzes';

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generateQuiz(content: string, topic?: string): Promise<GeneratedQuizResponse> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot generate quizzes from empty content.');
    }

    const prompt = this.buildPrompt(trimmedContent, topic);
    const systemPrompt = 'You are a JSON-only assistant. You respond ONLY with valid JSON arrays. Never include explanatory text, markdown, or any other content outside the JSON structure.';
    const minQuestions = this.minQuestionsForContent(trimmedContent);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 5000
      });

      const llmText = response.choices[0]?.message?.content?.trim();
      if (!llmText) {
        this.logger.error('Received empty response from OpenAI.');
        throw new InternalServerErrorException('LLM returned an empty quiz response.');
      }

      this.logger.log('OpenAI Response (Quiz):', llmText);

      let questions = this.parseQuestions(llmText);
      if (questions.length < minQuestions) {
        const missing = minQuestions - questions.length;
        this.logger.warn(
          `Quiz questions below minimum (${questions.length}/${minQuestions}). Requesting ${missing} more.`
        );
        const additional = await this.requestAdditionalQuestions(
          trimmedContent,
          questions,
          missing,
          topic
        );
        questions = this.mergeQuestions(questions, additional);
        if (questions.length < minQuestions) {
          this.logger.warn(`Quiz questions still below minimum (${questions.length}/${minQuestions}).`);
        }
      }
      const rawResponse = this.tryParseRaw(llmText);

      return {
        model: response.model ?? this.model,
        promptVersion: this.promptVersion,
        questions,
        rawResponse
      };
    } catch (error) {
      this.logger.error('OpenAI request failed:', error);
      throw new InternalServerErrorException('Unable to generate quizzes at the moment.');
    }
  }

  private buildPrompt(content: string, topic: string | undefined): string {
    const pageCount = this.countPages(content);
    const minQuestions = this.minQuestionsForContent(content);
    const exampleOutput = [
      {
        question: 'What is the primary product of photosynthesis?',
        options: ['Carbon dioxide', 'Glucose', 'Water', 'Nitrogen'],
        correctIndex: 1,
        explanation: 'Photosynthesis converts CO2 and water into glucose (C6H12O6) using light energy.',
        difficulty: 'easy',
        topicTag: 'Photosynthesis Basics'
      },
      {
        question: 'Which stage of photosynthesis occurs in the thylakoid membrane?',
        options: ['Calvin cycle', 'Glycolysis', 'Light-dependent reactions', 'Krebs cycle'],
        correctIndex: 2,
        explanation: 'Light-dependent reactions occur in the thylakoid membrane where light energy is captured.',
        difficulty: 'medium',
        topicTag: 'Photosynthesis Stages'
      }
    ];

    return [
      '=== STRICT JSON OUTPUT MODE ===',
      'You MUST output ONLY a valid JSON array. NO other text is allowed.',
      'DO NOT write: "Here is...", "It seems...", "To address...", "Based on...", "I can...", etc.',
      'DO NOT include <think> tags, reasoning, or explanations.',
      'DO NOT use markdown code fences like ```json.',
      'DO NOT create search queries or any other JSON structure.',
      '',
      'TASK: Create multiple-choice quiz questions from the source material to help students prepare for exams.',
      '',
      '=== YOUR ROLE ===',
      'You are an exam-setter creating questions that test deep understanding.',
      'This material could be for ANY subject and ANY grade level (elementary to PhD).',
      'Adapt your questions to match the complexity and style of the source material.',
      '',
      '=== WHAT TO PRIORITIZE ===',
      'Focus on concepts that are exam-critical:',
      '- Key definitions and terminology',
      '- Rules, procedures, and processes',
      '- Cause-and-effect relationships',
      '- Comparisons and contrasts',
      '- Important facts, formulas, equations, or data',
      '- Problem-solving methods or techniques',
      '- Exceptions, special cases, or conditions',
      '- Numerical values, thresholds, or ranges where present',
      '',
      '=== COVERAGE REQUIREMENTS ===',
      '- Scan the ENTIRE material, not just the beginning',
      '- Ensure wide coverage across ALL major topics/sections',
      '- Distribute questions across different concept types',
      '- Vary difficulty: mix of easy (recall), medium (application), hard (analysis/synthesis)',
      `- Minimum required questions: ${minQuestions} (3 per page across ${pageCount} pages)`,
      '',
      '=== REQUIRED JSON STRUCTURE ===',
      'Each object in the JSON array must have EXACTLY:',
      '- question (string): Clear, unambiguous question',
      '- options (array of 4 unique strings): All plausible and distinct',
      '- correctIndex (0–3): Zero-based index of correct answer',
      '- explanation (string): Why the answer is correct, referencing source material',
      '- difficulty ("easy", "medium", or "hard")',
      '- topicTag (string): Short, meaningful label for the question topic',
      '',
      '=== EXAMPLE OUTPUT ===',
      JSON.stringify(exampleOutput, null, 2),
      '',
      '=== QUALITY GUIDELINES ===',
      `- You MUST generate at least ${minQuestions} questions`,
      '- Generate as many questions as possible to ensure comprehensive coverage of ALL material',
      '- Create questions for EVERY major concept, definition, fact, procedure, and relationship',
      '- There is NO limit - the more questions, the better for exam preparation',
      '- If the material is short, split concepts into smaller questions without inventing facts',
      '- Questions must test understanding, not just memorization',
      '- All options should be plausible to avoid obvious wrong answers',
      '- Explanations must cite or paraphrase the source material',
      '- Avoid ambiguous wording that could confuse students',
      '- Match the academic level and terminology of the source material',
      '',
      topic ? `Topic: ${topic}` : '',
      '',
      '=== SOURCE MATERIAL ===',
      content,
      '',
      '=== OUTPUT (JSON ARRAY ONLY - START WITH [ AND END WITH ]) ==='
    ]
      .filter(Boolean)
      .join('\n');
  }

  private countPages(content: string): number {
    const matches = content.match(/^=== Page \d+ ===/gm);
    return matches?.length ?? 1;
  }

  private minQuestionsForContent(content: string): number {
    const pageCount = this.countPages(content);
    return Math.max(3, pageCount * 3);
  }

  private async requestAdditionalQuestions(
    content: string,
    existing: QuizQuestion[],
    missing: number,
    topic?: string
  ): Promise<QuizQuestion[]> {
    if (missing <= 0) {
      return [];
    }

    const existingQuestions = existing
      .map(question => question.question)
      .filter(Boolean)
      .slice(0, 120);

    const prompt = [
      '=== STRICT JSON OUTPUT MODE ===',
      'You MUST output ONLY a valid JSON array. NO other text is allowed.',
      '',
      `You already generated ${existing.length} questions, but need ${missing} more to reach the minimum.`,
      'Generate NEW questions that do not duplicate existing ones.',
      'Cover remaining concepts that are not yet covered.',
      '',
      existingQuestions.length
        ? `Existing questions (do not repeat):\n- ${existingQuestions.join('\n- ')}`
        : '',
      '',
      '=== REQUIRED JSON STRUCTURE ===',
      '- question (string)',
      '- options (array of 4 unique strings)',
      '- correctIndex (0-3)',
      '- explanation (string)',
      '- difficulty ("easy", "medium", or "hard")',
      '- topicTag (string)',
      '',
      topic ? `Topic: ${topic}` : '',
      '',
      '=== SOURCE MATERIAL ===',
      content,
      '',
      '=== OUTPUT (JSON ARRAY ONLY) ==='
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a JSON-only assistant.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 3500
      });
      const llmText = response.choices[0]?.message?.content?.trim();
      if (!llmText) {
        return [];
      }
      return this.parseQuestions(llmText);
    } catch (error) {
      this.logger.warn('Additional quiz request failed.', error as Error);
      return [];
    }
  }

  private mergeQuestions(existing: QuizQuestion[], additional: QuizQuestion[]): QuizQuestion[] {
    if (!additional.length) {
      return existing;
    }
    const seen = new Set(existing.map(question => question.question.trim().toLowerCase()));
    const merged = existing.slice();
    for (const question of additional) {
      const key = (question.question ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(question);
    }
    return merged;
  }

  private parseQuestions(raw: string): QuizQuestion[] {
    const cleaned = this.stripThinkTags(this.stripCodeFences(raw));
    try {
      const parsed = JSON.parse(cleaned) as QuizQuestion[] | { questions?: QuizQuestion[] };

      // Validate array structure
      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && this.hasWrongQuizStructure(parsed[0])) {
          this.logger.warn('Detected wrong JSON structure in quiz. Attempting recovery.');
          throw new Error('Invalid quiz structure detected');
        }
        return parsed;
      }
      if (parsed?.questions && Array.isArray(parsed.questions)) {
        return parsed.questions;
      }
    } catch (error) {
      this.logger.warn('Failed to parse quiz JSON, attempting to recover substring.', error as Error);
      const recovered = this.extractJsonArray(cleaned);
      if (recovered && recovered.length > 0 && !this.hasWrongQuizStructure(recovered[0])) {
        return recovered;
      }
    }
    try {
      const recovered = this.extractJsonArray(raw);
      if (recovered && recovered.length > 0 && !this.hasWrongQuizStructure(recovered[0])) {
        return recovered;
      }
    } catch (error) {
      this.logger.warn('Failed to parse quiz JSON, falling back to text.', error as Error);
    }

    return [
      {
        question: 'Unable to parse quiz response.',
        options: ['Try again later'],
        correctIndex: 0,
        explanation: cleaned || raw,
        difficulty: 'easy'
      }
    ];
  }

  private hasWrongQuizStructure(obj: any): boolean {
    // Check for common wrong structures that DeepSeek might generate
    const wrongKeys = ['search_query', 'page_numbers', 'results', 'id', 'text'];
    return wrongKeys.some(key => key in obj) || !('question' in obj && 'options' in obj && 'correctIndex' in obj);
  }

  private tryParseRaw(raw: string): unknown {
    const cleaned = this.stripBoilerplate(raw);
    try {
      return JSON.parse(cleaned);
    } catch {
      return cleaned || raw;
    }
  }

  private stripCodeFences(raw: string): string {
    return raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  }

  private stripThinkTags(raw: string): string {
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  private stripBoilerplate(raw: string): string {
    let cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json/gi, '')
      .replace(/```/g, '');

    // Remove common conversational prefixes that DeepSeek-R1 adds
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

  private extractJsonArray(raw: string): QuizQuestion[] | null {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      const snippet = raw.slice(start, end + 1);
      const parsed = JSON.parse(snippet);
      if (Array.isArray(parsed)) {
        return parsed as QuizQuestion[];
      }
    } catch {
      return null;
    }
    return null;
  }
}
