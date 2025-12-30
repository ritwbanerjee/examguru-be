export class ProcessingLimitError extends Error {
  code?: string;
  meta?: Record<string, unknown>;

  constructor(message: string, code?: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'ProcessingLimitError';
    this.code = code;
    this.meta = meta;
  }
}
