import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

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
  private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  private readonly model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  private readonly promptVersion = 'v1-quizzes';

  async generateQuiz(content: string, topic?: string, count = 5): Promise<GeneratedQuizResponse> {
    const fetchImpl = (globalThis as any).fetch as typeof fetch | undefined;
    if (!fetchImpl) {
      throw new InternalServerErrorException(
        'Fetch API is not available in this Node.js runtime. Please use Node 18+.'
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot generate quizzes from empty content.');
    }

    const prompt = this.buildPrompt(trimmedContent, topic, count);
    const response = await fetchImpl(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        keep_alive: '5m'
      })
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Ollama quiz request failed: ${response.status} - ${text}`);
      throw new InternalServerErrorException('Unable to generate quizzes at the moment.');
    }

    const payload = (await response.json()) as { response?: string; model?: string };
    const llmText = payload?.response?.trim();
    if (!llmText) {
      throw new InternalServerErrorException('LLM returned an empty quiz response.');
    }

    const questions = this.parseQuestions(llmText);
    const rawResponse = this.tryParseRaw(llmText);

    return {
      model: payload?.model ?? this.model,
      promptVersion: this.promptVersion,
      questions,
      rawResponse
    };
  }

  private buildPrompt(content: string, topic: string | undefined, count: number): string {
    return [
      'You are an AI exam coach that writes multiple-choice quiz questions.',
      'Return ONLY valid JSON matching this exact TypeScript interface:',
      JSON.stringify(
        [
          {
            question: 'Question text',
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            correctIndex: 0,
            explanation: 'Brief explanation referencing the source content',
            difficulty: 'easy | medium | hard',
            topicTag: 'Optional short tag to group similar concepts'
          }
        ],
        null,
        2
      ),
      `Generate ${count} high-quality questions unless there is not enough material.`,
      '- Maintain unique options per question.',
      '- correctIndex must be a zero-based index into the options array.',
      '- explanation should justify the correct answer.',
      '- difficulty should reflect Bloom’s taxonomy level.',
      topic ? `Topic or working title: ${topic}` : '',
      'Source material:',
      content
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private parseQuestions(raw: string): QuizQuestion[] {
    const cleaned = this.stripCodeFences(raw);
    try {
      const parsed = JSON.parse(cleaned) as QuizQuestion[] | { questions?: QuizQuestion[] };
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed?.questions && Array.isArray(parsed.questions)) {
        return parsed.questions;
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

  private tryParseRaw(raw: string): unknown {
    const cleaned = this.stripCodeFences(raw);
    try {
      return JSON.parse(cleaned);
    } catch {
      return cleaned || raw;
    }
  }

  private stripCodeFences(raw: string): string {
    return raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  }
}
