import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StudySet } from './study-set.schema';
import { StudySetAiJob } from './study-set-ai-job.schema';

export type StudySetAiResultDocument = HydratedDocument<StudySetAiResult>;

export type StudySetAiFeature = 'summary' | 'flashcards' | 'quizzes';
export type StudySetAiResultStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Schema({ timestamps: true })
export class StudySetAiResult {
  @Prop({ type: Types.ObjectId, ref: StudySetAiJob.name, required: true })
  job!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: StudySet.name, required: true })
  studySet!: Types.ObjectId;

  @Prop({ required: true })
  fileId!: string;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ type: String, enum: ['summary', 'flashcards', 'quizzes'], required: true })
  feature!: StudySetAiFeature;

  @Prop({ type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' })
  status!: StudySetAiResultStatus;

  @Prop({ type: Object, default: null })
  result!: unknown | null;

  @Prop({ type: String, default: null })
  error!: string | null;
}

export const StudySetAiResultSchema = SchemaFactory.createForClass(StudySetAiResult);

StudySetAiResultSchema.index({ studySet: 1, fileId: 1, feature: 1 }, { unique: true });
