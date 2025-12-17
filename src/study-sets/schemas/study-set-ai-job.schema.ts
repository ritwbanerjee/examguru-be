import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StudySet } from './study-set.schema';
import { User } from '../../users/schemas/user.schema';

export type StudySetAiJobDocument = HydratedDocument<StudySetAiJob>;

export type StudySetAiJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AiProcessFileSnapshot {
  fileId: string;
  fileName: string;
  uploadedAt: Date;
  extension: string;
  mimeType?: string | null;
  sizeBytes: number;
  displaySize: string;
  status: string;
  selectedRange?: { start: number; end: number } | null;
  rangeSummary?: string | null;
  extractedText?: string | null;
  notes: string[];
}

@Schema({ timestamps: true })
export class StudySetAiJob {
  @Prop({ required: true, unique: true })
  jobId!: string;

  @Prop({ type: Types.ObjectId, ref: StudySet.name, required: true })
  studySet!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ required: true })
  requestedAt!: Date;

  @Prop({ required: true })
  queuedAt!: Date;

  @Prop({ type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' })
  status!: StudySetAiJobStatus;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ default: 3 })
  maxAttempts!: number;

  @Prop({ default: 30000 })
  backoffMs!: number;

  @Prop({ default: () => new Date() })
  nextAttemptAt!: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  lastError?: string;

  @Prop({ type: Object, required: true })
  payload!: {
    preferredLanguage?: string | null;
    aiFeatures: string[];
    manualContent?: string | null;
    files: AiProcessFileSnapshot[];
  };
}

export const StudySetAiJobSchema = SchemaFactory.createForClass(StudySetAiJob);

StudySetAiJobSchema.index({ status: 1, queuedAt: 1 });
StudySetAiJobSchema.index({ status: 1, createdAt: 1 });
StudySetAiJobSchema.index({ jobId: 1 }, { unique: true });
