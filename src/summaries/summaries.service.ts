import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';

export interface StructuredSummary {
  title: string;
  summary: string;
  detailed_summary?: string;
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
  detailed_summary: '',
  key_points: [],
  study_recommendations: [],
  confidence: 'unknown'
};

@Injectable()
export class SummariesService {
  private readonly logger = new Logger(SummariesService.name);
  private readonly openai: OpenAI;
  private readonly model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  private readonly promptVersion = 'v1-structured-summary';

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generateStructuredSummary(content: string, topic?: string): Promise<GeneratedSummaryResponse> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new InternalServerErrorException('Cannot summarize empty content.');
    }

    const prompt = this.buildPrompt(trimmedContent, topic);
    const systemPrompt = `
                          You are a highly capable AI study assistant.

                          You read academic or informational material of ANY subject and ANY grade level
                          and transform it into clear, structured study notes for students.

                          Your responsibilities:
                          - Preserve ALL important facts and ideas.
                          - Explain concepts in simple, student-friendly language.
                          - Never remove key details; reduce only redundancy.
                          - Organize content logically and consistently.
                          - Avoid filler, vague statements, or invented information.
                          `;


    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 3000
      });

      const llmText = response.choices[0]?.message?.content?.trim();
      if (!llmText) {
        this.logger.error('Received empty response from OpenAI.');
        throw new InternalServerErrorException('LLM returned an empty response.');
      }

      this.logger.log('OpenAI Response (Summary):', llmText);

      const structuredSummary = this.parseStructuredSummary(llmText);
      const rawResponse = this.tryParseRawResponse(llmText);

      return {
        model: response.model ?? this.model,
        promptVersion: this.promptVersion,
        summary: structuredSummary,
        rawResponse
      };
    } catch (error) {
      this.logger.error('OpenAI request failed:', error);
      throw new InternalServerErrorException('Unable to generate summary at the moment.');
    }
  }

  private buildPrompt(content: string, topic?: string): string {

    return [
      '=== STRICT JSON OUTPUT MODE ===',
      'Output ONLY a valid JSON object. No explanations no reasoning, and no commentary.',
      '',
      'TASK:',
      'Analyze the source material and create a detailed educational summary suitable for exam preparation.',
      '',
      '=== YOUR ROLE ===',
      'You are an AI study assistant. You can summarize ANY subject at ANY grade level.',
      'Your goal is to produce clear, accurate, and thorough study notes so a student can understand and revise the material.',
      '',
      '=== WHAT TO INCLUDE ===',
      '- Main ideas and core concepts',
      '- Key definitions and terminology',
      '- Important facts, principles, rules, or theories',
      '- Key processes, procedures, steps, or methods',
      '- Relationships, comparisons, or contrasts between ideas',
      '- Formulas, equations, data, or examples, when they appear in the text',
      '',
      '=== COVERAGE REQUIREMENTS ===',
      '- Cover ALL major sections/topics proportionally (not just the introduction).',
      '- Do NOT skip important concepts or sections.',
      '- Rewrite ideas clearly for a student audience, without changing the meaning.',
      '- Combine repetitive points into coherent explanations.',
      '- Do NOT invent information that is not present in the source.',
      '- If the text has headings, articles, chapters, bullet groups, or numbered sections,',
      '  reflect that structure in the detailed_summary.',
      '',
      '=== REQUIRED JSON STRUCTURE ===',
      '{',
      '  "title": string,',
      '  "summary": string,                  // short 2–4 sentence high-level overview',
      '  "detailed_summary": string,         // 400–700 words, formatted as a numbered outline with bullets',
      '  "key_points": [',
      '    { "heading": string, "detail": string }',
      '  ],                                   // 5–10 key points, each at most 2 sentences',
      '  "study_recommendations": [ string ], // actionable, content-specific suggestions',
      '  "confidence": "high" | "medium" | "low"',
      '}',
      '',
      '=== FORMAT FOR "detailed_summary" (VERY IMPORTANT) ===',
      '- Write detailed_summary as a markdown-style outline using this structure:',
      '',
      '1. <Section name>',
      '- <bullet point 1>',
      '- <bullet point 2>',
      '',
      '2. <Next section name>',
      '- <bullet point 1>',
      '- <bullet point 2>',
      '',
      '3. <Next section name>',
      '- <bullet point 1>',
      '- <bullet point 2>',
      '',
      '- You MUST include at least 4 numbered sections (1., 2., 3., 4.) if the source text is long.',
      '- Each section should correspond to a major topic, heading, or logical part of the material.',
      '- Aim for 400–700 words total in detailed_summary. Most of your output tokens should go here.',
      '',
      '=== QUALITY GUIDELINES ===',
      '- The detailed_summary MUST be the longest and richest part of the JSON.',
      '- Use clear, simple, student-friendly language while keeping correct technical terms when needed.',
      '- Ensure the numbered sections, taken together, cover the full scope of the material.',
      '- Study recommendations must be specific to this content (what to review, practice, memorize, compare, map, etc.).',
      '- Avoid generic advice that could apply to any topic.',
      '',
      topic ? `Topic: ${topic}` : '',
      '',
      '=== SOURCE MATERIAL ===',
      content,
      '',
      '=== OUTPUT JSON ONLY — START WITH { AND END WITH } ==='
    ]
      .filter(Boolean)
      .join('\n');
  }

  private parseStructuredSummary(raw: string): StructuredSummary {
    const cleaned = this.cleanResponse(raw);
    try {
      const parsed = JSON.parse(cleaned);

      // Validate structure - reject if wrong keys are present
      if (this.hasWrongStructure(parsed)) {
        this.logger.warn('Detected wrong JSON structure (e.g., search_query). Attempting recovery.');
        throw new Error('Invalid JSON structure detected');
      }

      return {
        ...DEFAULT_SUMMARY,
        ...parsed,
        key_points: parsed?.key_points ?? DEFAULT_SUMMARY.key_points,
        study_recommendations: parsed?.study_recommendations ?? DEFAULT_SUMMARY.study_recommendations,
        confidence: parsed?.confidence ?? DEFAULT_SUMMARY.confidence
      };
    } catch (error) {
      this.logger.warn('Failed to parse structured summary JSON. Attempting recovery.', error as Error);
      const recovered = this.extractJsonObject(cleaned) ?? this.extractJsonObject(raw);
      if (recovered && !this.hasWrongStructure(recovered)) {
        return {
          ...DEFAULT_SUMMARY,
          ...recovered,
          key_points: recovered?.key_points ?? DEFAULT_SUMMARY.key_points,
          study_recommendations: recovered?.study_recommendations ?? DEFAULT_SUMMARY.study_recommendations,
          confidence: recovered?.confidence ?? DEFAULT_SUMMARY.confidence
        };
      }
      this.logger.warn('Falling back to plain text summary.', error as Error);
      return {
        ...DEFAULT_SUMMARY,
        summary: cleaned || raw
      };
    }
  }

  private hasWrongStructure(obj: any): boolean {
    // Check for common wrong structures that DeepSeek might generate
    const wrongKeys = ['search_query', 'page_numbers', 'results', 'id', 'text'];
    return wrongKeys.some(key => key in obj);
  }

  private tryParseRawResponse(raw: string): unknown {
    const cleaned = this.cleanResponse(raw);
    try {
      return JSON.parse(cleaned);
    } catch {
      return this.extractJsonObject(cleaned) ?? cleaned ?? raw;
    }
  }

  private stripCodeFences(raw: string): string {
    return raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  }

  private stripThinkTags(raw: string): string {
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  private cleanResponse(raw: string): string {
    let cleaned = this.stripThinkTags(this.stripCodeFences(raw));

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

  private extractJsonObject(raw: string): StructuredSummary | null {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      const snippet = raw.slice(start, end + 1);
      const parsed = JSON.parse(snippet);
      return parsed as StructuredSummary;
    } catch {
      return null;
    }
  }
}
