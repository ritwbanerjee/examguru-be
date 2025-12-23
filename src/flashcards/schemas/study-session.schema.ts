import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StudySet } from '../../study-sets/schemas/study-set.schema';
import { User } from '../../users/schemas/user.schema';

export type StudySessionDocument = HydratedDocument<StudySession>;

export type SessionFilterType = 'all' | 'unmastered' | 'mastered';

@Schema({ timestamps: true })
export class StudySession {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: StudySet.name, required: true })
  studySet!: Types.ObjectId;

  // Session context
  @Prop({ type: String, enum: ['all', 'unmastered', 'mastered'], required: true })
  filterType!: SessionFilterType;

  // Timing
  @Prop({ type: Date, required: true })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ default: 0 })
  duration!: number; // Seconds spent studying

  // Progress
  @Prop({ default: 0 })
  cardsStudied!: number;

  @Prop({ default: 0 })
  cardsMastered!: number;

  @Prop({ default: 0 })
  cardsNeedingReview!: number;

  // Optional: Track which cards were studied (for analytics)
  @Prop({ type: [String], default: [] })
  flashcardIds!: string[];
}

export const StudySessionSchema = SchemaFactory.createForClass(StudySession);

// Indexes
StudySessionSchema.index({ user: 1, studySet: 1, completedAt: -1 });
StudySessionSchema.index({ user: 1, completedAt: 1 });
