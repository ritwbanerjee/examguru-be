import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StudySet } from '../../study-sets/schemas/study-set.schema';
import { User } from '../../users/schemas/user.schema';

export type FlashcardProgressDocument = HydratedDocument<FlashcardProgress>;

export type FlashcardDifficulty = 'intro' | 'intermediate' | 'advanced';

@Schema({ timestamps: true })
export class FlashcardProgress {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: StudySet.name, required: true })
  studySet!: Types.ObjectId;

  @Prop({ required: true })
  flashcardId!: string;

  // Denormalized content for query performance
  @Prop({ required: true })
  prompt!: string;

  @Prop({ required: true })
  sourceFile!: string;

  @Prop({ type: String, enum: ['intro', 'intermediate', 'advanced'], required: true })
  difficulty!: FlashcardDifficulty;

  // User progress
  @Prop({ default: false })
  mastered!: boolean;

  @Prop({ default: 0 })
  timesStudied!: number;

  @Prop({ default: 0 })
  timesCorrect!: number;

  @Prop({ default: 0 })
  timesIncorrect!: number;

  @Prop({ type: Date, default: null })
  lastReviewed!: Date | null;

  @Prop({ type: Date, default: null })
  firstStudied!: Date | null;

  // For future spaced repetition (out of scope for MVP)
  @Prop({ type: Date, default: null })
  nextReviewDate!: Date | null;

  @Prop({ default: 2.5 })
  easeFactor!: number;

  @Prop({ default: 0 })
  interval!: number;
}

export const FlashcardProgressSchema = SchemaFactory.createForClass(FlashcardProgress);

// Indexes
FlashcardProgressSchema.index({ user: 1, studySet: 1 });
FlashcardProgressSchema.index({ user: 1, studySet: 1, mastered: 1 });
FlashcardProgressSchema.index({ user: 1, studySet: 1, flashcardId: 1 }, { unique: true });
