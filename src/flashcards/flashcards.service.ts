import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

export interface Flashcard {
  prompt: string;
  answer: string;
  followUp: string;
  difficulty: 'intro' | 'intermediate' | 'advanced' | string;
}

export interface GeneratedFlashcardsResponse {
  model: string;
  promptVersion: string;
  flashcards: Flashcard[];
  rawResponse: unknown;
}

@Injectable()
export class FlashcardsService {
  private readonly logger = new Logger(FlashcardsService.name);
  private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  private readonly model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  private readonly promptVersion = 'v1-flashcards';

  async generateFlashcards(content: string, topic?: string, count = 6): Promise<GeneratedFlashcardsResponse> {
    const fetchImpl = (globalThis as any).fetch as typeof fetch | undefined;
    if (!fetchImpl) {
      throw new InternalServerErrorException(
        'Fetch API is not available in this Node.js runtime. Please use Node 18+.'
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot generate flashcards from empty content.');
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
      this.logger.error(`Ollama flashcard request failed: ${response.status} - ${text}`);
      throw new InternalServerErrorException('Unable to generate flashcards at the moment.');
    }

    const payload = (await response.json()) as { response?: string; model?: string };
    const llmText = payload?.response?.trim();
    if (!llmText) {
      throw new InternalServerErrorException('LLM returned an empty flashcard response.');
    }

    const flashcards = this.parseFlashcards(llmText);
    const rawResponse = this.tryParseRaw(llmText);

    return {
      model: payload?.model ?? this.model,
      promptVersion: this.promptVersion,
      flashcards,
      rawResponse
    };
  }

  private buildPrompt(content: string, topic: string | undefined, count: number): string {
    return [
      'You are an AI tutor that creates exam-ready flashcards.',
      'Return ONLY valid JSON matching this exact TypeScript interface:',
      JSON.stringify(
        [
          {
            prompt: 'Question or cue text',
            answer: 'Concise answer in 1-2 sentences',
            followUp: 'Optional follow-up action/reminder',
            difficulty: 'intro | intermediate | advanced'
          }
        ],
        null,
        2
      ),
      `Generate exactly ${count} cards unless there is not enough material.`,
      '- Keep prompts short and specific.',
      '- Answers should reference the source material directly.',
      '- Difficulty should reflect how complex the concept is.',
      '- followUp is optional but useful for application tasks.',
      topic ? `Topic or working title: ${topic}` : '',
      'Source material:',
      content
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private parseFlashcards(raw: string): Flashcard[] {
    const cleaned = this.stripCodeFences(raw);
    try {
      const parsed = JSON.parse(cleaned) as Flashcard[] | { flashcards?: Flashcard[] };
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed?.flashcards && Array.isArray(parsed.flashcards)) {
        return parsed.flashcards;
      }
    } catch (error) {
      this.logger.warn('Failed to parse flashcards JSON, falling back to text.', error as Error);
    }
    return [
      {
        prompt: 'Unable to parse flashcards',
        answer: cleaned || raw,
        followUp: 'Try regenerating the flashcards.',
        difficulty: 'intro'
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
