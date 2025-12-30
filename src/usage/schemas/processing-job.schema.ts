import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { StudySet } from '../../study-sets/schemas/study-set.schema';

export type ProcessingJobDocument = HydratedDocument<ProcessingJob>;

export type ProcessingJobStatus = 'success' | 'blocked' | 'aborted';

@Schema({ timestamps: true })
export class ProcessingJob {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: StudySet.name, required: true })
  studySet!: Types.ObjectId;

  @Prop({ required: true })
  fileId!: string;

  @Prop({ default: 0 })
  pages!: number;

  @Prop({ default: 0 })
  ocrPages!: number;

  @Prop({ default: 0 })
  visionImages!: number;

  @Prop({ default: 0 })
  visionUnits!: number;

  @Prop({ default: 0 })
  tokensIn!: number;

  @Prop({ default: 0 })
  tokensOut!: number;

  @Prop({ required: true, enum: ['success', 'blocked', 'aborted'] })
  status!: ProcessingJobStatus;

  @Prop()
  statusReason?: string;
}

export const ProcessingJobSchema = SchemaFactory.createForClass(ProcessingJob);
ProcessingJobSchema.index({ user: 1, createdAt: -1 });
ProcessingJobSchema.index({ studySet: 1, createdAt: -1 });
