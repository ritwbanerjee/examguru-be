import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type StudySetDocument = HydratedDocument<StudySet>;

@Schema({ _id: false })
export class FileSummary {
  @Prop({
    type: Types.ObjectId,
    required: true,
    default: () => new Types.ObjectId()
  })
  fileId!: Types.ObjectId;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  uploadedAt!: Date;

  @Prop({ required: true })
  extension!: string;

  @Prop({ required: true })
  sizeBytes!: number;

  @Prop({ required: true })
  displaySize!: string;
}

export const FileSummarySchema = SchemaFactory.createForClass(FileSummary);

@Schema({ timestamps: true })
export class StudySet {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ type: String, default: null })
  preferredLanguage?: string | null;

  @Prop({ type: Map, of: Boolean, default: {} })
  aiFeatures!: Record<string, boolean>;

  @Prop({ type: [FileSummarySchema], default: [] })
  fileSummaries!: FileSummary[];

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const StudySetSchema = SchemaFactory.createForClass(StudySet);
