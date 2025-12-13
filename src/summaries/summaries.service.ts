import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

export interface StructuredSummary {
  title: string;
  summary: string;
  key_points: Array<{
    heading: string;
    detail: string;
  }>;
  study_recommendations: string[];
  confidence: 'high' | 'medium' | 'low' | string;
}

export interface GeneratedSummaryResponse {
  model: string;
  promptVersion: string;
  summary: StructuredSummary;
  rawResponse: unknown;
}

const DEFAULT_SUMMARY: StructuredSummary = {
  title: 'Study Summary',
  summary: '',
  key_points: [],
  study_recommendations: [],
  confidence: 'unknown'
};

@Injectable()
export class SummariesService {
  private readonly logger = new Logger(SummariesService.name);
  private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  private readonly model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  private readonly promptVersion = 'v1-structured-summary';

  async generateStructuredSummary(content: string, topic?: string): Promise<GeneratedSummaryResponse> {
    const fetchImpl = (globalThis as any).fetch as typeof fetch | undefined;
    if (!fetchImpl) {
      throw new InternalServerErrorException(
        'Fetch API is not available in this Node.js runtime. Please use Node 18+.'
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot summarize empty content.');
    }

    const prompt = this.buildPrompt(trimmedContent, topic);
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

    console.log('BODY: ', JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        keep_alive: '5m'
      }))

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Ollama request failed: ${response.status} - ${text}`);
      throw new InternalServerErrorException('Unable to generate summary at the moment.');
    }

    const payload = (await response.json()) as {
      response?: string;
      model?: string;
    };

    const llmText = payload?.response?.trim();
    if (!llmText) {
      this.logger.error('Received empty response from LLM.');
      throw new InternalServerErrorException('LLM returned an empty response.');
    }

    const structuredSummary = this.parseStructuredSummary(llmText);
    const rawResponse = this.tryParseRawResponse(llmText);

    return {
      model: payload?.model ?? this.model,
      promptVersion: this.promptVersion,
      summary: structuredSummary,
      rawResponse
    };
  }

  private buildPrompt(content: string, topic?: string): string {
    return [
      'You are an educational AI assistant that writes concise, structured summaries for students.',
      'Return ONLY valid JSON that matches this interface:',
      JSON.stringify(
        {
          title: 'string - descriptive title for the content',
          summary: 'string - 2 to 3 sentence overview',
          key_points: [
            {
              heading: 'short heading',
              detail: '1-2 sentence explanation in simple language'
            }
          ],
          study_recommendations: ['actionable tip 1', 'actionable tip 2'],
          confidence: 'high | medium | low'
        },
        null,
        2
      ),
      'Guidelines:',
      '- Focus on clarity and helpfulness. Avoid jargon when possible.',
      '- Never include markdown code fences or extra commentary—only JSON.',
      '- Limit key_points to 5 or fewer items.',
      '- study_recommendations should be concrete actions or reminders.',
      topic ? `Topic or working title: ${topic}` : '',
      'Source material to summarize:',
      content
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private parseStructuredSummary(raw: string): StructuredSummary {
    const cleaned = this.stripCodeFences(raw);
    try {
      const parsed = JSON.parse(cleaned);
      return {
        ...DEFAULT_SUMMARY,
        ...parsed,
        key_points: parsed?.key_points ?? DEFAULT_SUMMARY.key_points,
        study_recommendations: parsed?.study_recommendations ?? DEFAULT_SUMMARY.study_recommendations,
        confidence: parsed?.confidence ?? DEFAULT_SUMMARY.confidence
      };
    } catch (error) {
      this.logger.warn('Failed to parse structured summary JSON. Falling back to plain text.', error as Error);
      return {
        ...DEFAULT_SUMMARY,
        summary: cleaned || raw
      };
    }
  }

  private tryParseRawResponse(raw: string): unknown {
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
