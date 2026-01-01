import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { StudySet } from '../../study-sets/schemas/study-set.schema';

export type ActivityLogDocument = HydratedDocument<ActivityLog>;

@Schema({ timestamps: true })
export class ActivityLog {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  detail!: string;

  @Prop()
  icon?: string;

  @Prop({ type: Types.ObjectId, ref: StudySet.name })
  studySet?: Types.ObjectId;

  @Prop()
  fileId?: string;

  @Prop()
  activityKey?: string;

  @Prop()
  timestamp?: Date;

  @Prop({ type: Object })
  meta?: Record<string, unknown>;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);

ActivityLogSchema.index({ user: 1, createdAt: -1 });
ActivityLogSchema.index(
  { user: 1, activityKey: 1 },
  { unique: true, partialFilterExpression: { activityKey: { $exists: true } } }
);
