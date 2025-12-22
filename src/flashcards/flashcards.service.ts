import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';

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
  private readonly openai: OpenAI;
  private readonly model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  private readonly promptVersion = 'v3-flashcards';

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generateFlashcards(content: string, topic?: string): Promise<GeneratedFlashcardsResponse> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot generate flashcards from empty content.');
    }

    const prompt = this.buildPrompt(trimmedContent, topic);
    const systemPrompt = 'You are a JSON-only assistant. You respond ONLY with valid JSON arrays. Never include explanatory text, markdown, or any other content outside the JSON structure.';
    const minCards = this.minFlashcardsForContent(trimmedContent);

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
        throw new InternalServerErrorException('LLM returned an empty flashcard response.');
      }

      this.logger.log('OpenAI Response (Flashcards):', llmText);

      let flashcards = this.parseFlashcards(llmText);
      if (flashcards.length < minCards) {
        const missing = minCards - flashcards.length;
        this.logger.warn(
          `Flashcards below minimum (${flashcards.length}/${minCards}). Requesting ${missing} more.`
        );
        const additional = await this.requestAdditionalFlashcards(
          trimmedContent,
          flashcards,
          missing,
          topic
        );
        flashcards = this.mergeFlashcards(flashcards, additional);
        if (flashcards.length < minCards) {
          this.logger.warn(`Flashcards still below minimum (${flashcards.length}/${minCards}).`);
        }
      }
      const rawResponse = this.tryParseRaw(llmText);

      return {
        model: response.model ?? this.model,
        promptVersion: this.promptVersion,
        flashcards,
        rawResponse
      };
    } catch (error) {
      this.logger.error('OpenAI request failed:', error);
      throw new InternalServerErrorException('Unable to generate flashcards at the moment.');
    }
  }

  private buildPrompt(content: string, topic: string | undefined): string {
    const pageCount = this.countPages(content);
    const minCards = this.minFlashcardsForContent(content);
    const exampleOutput = [
      {
        prompt: 'What is the primary function of mitochondria?',
        answer: 'Mitochondria are the powerhouse of the cell, generating ATP through cellular respiration.',
        followUp: 'Review the electron transport chain process',
        difficulty: 'intro'
      },
      {
        prompt: 'Explain the difference between aerobic and anaerobic respiration',
        answer: 'Aerobic respiration requires oxygen and produces ~38 ATP, while anaerobic produces only 2 ATP without oxygen.',
        followUp: 'Practice drawing both pathways',
        difficulty: 'intermediate'
      }
    ];

    return [
      '=== STRICT JSON OUTPUT MODE ===',
      'You MUST output ONLY a valid JSON array. NO other text is allowed.',
      'DO NOT include explanations, <think> tags, or markdown fences.',
      '',
      'TASK: Create exam-ready flashcards from the source material to help students study effectively.',
      '',
      '=== YOUR ROLE ===',
      'You are creating flashcards for active recall and spaced repetition study.',
      'This material could be for ANY subject and ANY grade level (elementary to PhD).',
      'Adapt your flashcards to match the complexity and style of the source material.',
      '',
      '=== WHAT TO COVER ===',
      'Focus on exam-critical content across ALL sections of the material:',
      '- Key definitions and terminology',
      '- Important facts, concepts, and principles',
      '- Rules, procedures, and processes',
      '- Formulas, equations, or calculations',
      '- Cause-and-effect relationships',
      '- Comparisons between related concepts',
      '- Examples and applications',
      '- Exceptions or special cases',
      '- Numerical values or data points where present',
      '',
      '=== COVERAGE REQUIREMENTS ===',
      '- Scan the ENTIRE material, not just the beginning',
      '- Distribute flashcards across ALL major topics/sections',
      '- Include a mix of difficulty levels (intro, intermediate, advanced)',
      '- Ensure comprehensive coverage for exam preparation',
      `- Minimum required flashcards: ${minCards} (3 per page across ${pageCount} pages)`,
      '',
      '=== REQUIRED JSON STRUCTURE ===',
      'Each flashcard must include EXACTLY:',
      '- prompt (string): Question or cue (short, specific, clear)',
      '- answer (string): Concise answer in 1–2 sentences from source material',
      '- followUp (string): Actionable study tip or related concept to review',
      '- difficulty ("intro", "intermediate", or "advanced")',
      '',
      '=== EXAMPLE OUTPUT ===',
      JSON.stringify(exampleOutput, null, 2),
      '',
      '=== QUALITY GUIDELINES ===',
      `- You MUST generate at least ${minCards} flashcards`,
      '- Generate as many flashcards as possible to ensure comprehensive coverage of ALL material',
      '- Create flashcards for EVERY major concept, definition, fact, formula, and process',
      '- There is NO limit - the more flashcards, the better for exam preparation',
      '- If the material is short, split concepts into smaller, more granular cards without inventing facts',
      '- Prompts should be direct questions or fill-in-the-blank cues',
      '- Answers must come from the source material, not general knowledge',
      '- FollowUp should help students deepen understanding or make connections',
      '- Match the academic level and terminology of the source material',
      '- Avoid overly broad or vague prompts',
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

  private minFlashcardsForContent(content: string): number {
    const pageCount = this.countPages(content);
    return Math.max(3, pageCount * 3);
  }

  private async requestAdditionalFlashcards(
    content: string,
    existing: Flashcard[],
    missing: number,
    topic?: string
  ): Promise<Flashcard[]> {
    if (missing <= 0) {
      return [];
    }

    const existingPrompts = existing
      .map(card => card.prompt)
      .filter(Boolean)
      .slice(0, 120);

    const prompt = [
      '=== STRICT JSON OUTPUT MODE ===',
      'You MUST output ONLY a valid JSON array. NO other text is allowed.',
      '',
      `You already generated ${existing.length} flashcards, but need ${missing} more to reach the minimum.`,
      'Generate NEW flashcards that do not duplicate existing prompts.',
      'Cover remaining concepts that are not yet covered.',
      '',
      existingPrompts.length
        ? `Existing prompts (do not repeat):\n- ${existingPrompts.join('\n- ')}`
        : '',
      '',
      '=== REQUIRED JSON STRUCTURE ===',
      '- prompt (string)',
      '- answer (string)',
      '- followUp (string)',
      '- difficulty ("intro", "intermediate", or "advanced")',
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
      return this.parseFlashcards(llmText);
    } catch (error) {
      this.logger.warn('Additional flashcard request failed.', error as Error);
      return [];
    }
  }

  private mergeFlashcards(existing: Flashcard[], additional: Flashcard[]): Flashcard[] {
    if (!additional.length) {
      return existing;
    }
    const seen = new Set(existing.map(card => card.prompt.trim().toLowerCase()));
    const merged = existing.slice();
    for (const card of additional) {
      const key = (card.prompt ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(card);
    }
    return merged;
  }

  private parseFlashcards(raw: string): Flashcard[] {
    const cleaned = this.stripBoilerplate(raw);
    try {
      const parsed = JSON.parse(cleaned) as Flashcard[] | { flashcards?: Flashcard[] };

      // Validate array structure
      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && this.hasWrongFlashcardStructure(parsed[0])) {
          this.logger.warn('Detected wrong JSON structure in flashcards. Attempting recovery.');
          throw new Error('Invalid flashcard structure detected');
        }
        return parsed;
      }
      if (parsed?.flashcards && Array.isArray(parsed.flashcards)) {
        return parsed.flashcards;
      }
    } catch (error) {
      this.logger.warn('Failed to parse flashcards JSON, attempting to recover substring.', error as Error);
      const recovered = this.extractJsonArray(cleaned);
      if (recovered && recovered.length > 0 && !this.hasWrongFlashcardStructure(recovered[0])) {
        return recovered;
      }
    }
    try {
      const recovered = this.extractJsonArray(raw);
      if (recovered && recovered.length > 0 && !this.hasWrongFlashcardStructure(recovered[0])) {
        return recovered;
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

  private hasWrongFlashcardStructure(obj: any): boolean {
    // Check for common wrong structures that DeepSeek might generate
    const wrongKeys = ['search_query', 'page_numbers', 'results', 'id', 'text'];
    return wrongKeys.some(key => key in obj) || !('prompt' in obj && 'answer' in obj);
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

  private extractJsonArray(raw: string): Flashcard[] | null {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      const snippet = raw.slice(start, end + 1);
      const parsed = JSON.parse(snippet);
      if (Array.isArray(parsed)) {
        return parsed as Flashcard[];
      }
    } catch {
      return null;
    }
    return null;
  }
}
