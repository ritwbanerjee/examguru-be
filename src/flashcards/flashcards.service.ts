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
  private readonly promptVersion = 'v1-flashcards';

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

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4000
      });

      const llmText = response.choices[0]?.message?.content?.trim();
      if (!llmText) {
        this.logger.error('Received empty response from OpenAI.');
        throw new InternalServerErrorException('LLM returned an empty flashcard response.');
      }

      this.logger.log('OpenAI Response (Flashcards):', llmText);

      const flashcards = this.parseFlashcards(llmText);
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
      '- Generate as many flashcards as possible to ensure comprehensive coverage of ALL material',
      '- Create flashcards for EVERY major concept, definition, fact, formula, and process',
      '- There is NO limit - the more flashcards, the better for exam preparation',
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
