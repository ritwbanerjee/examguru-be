import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { StudySet } from '../../study-sets/schemas/study-set.schema';

export type StudyActivityDailyDocument = HydratedDocument<StudyActivityDaily>;

@Schema({ timestamps: true })
export class StudyActivityDaily {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: StudySet.name, required: true })
  studySet!: Types.ObjectId;

  @Prop({ required: true })
  dateKey!: string;

  @Prop({ default: 0 })
  minutes!: number;

  @Prop()
  lastActiveAt?: Date;
}

export const StudyActivityDailySchema = SchemaFactory.createForClass(StudyActivityDaily);

StudyActivityDailySchema.index({ user: 1, dateKey: 1 });
StudyActivityDailySchema.index({ user: 1, studySet: 1, dateKey: 1 }, { unique: true });
