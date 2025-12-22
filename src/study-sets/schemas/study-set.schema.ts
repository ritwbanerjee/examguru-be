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

  @Prop({ type: String, default: null })
  storageKey?: string | null;

  @Prop({ type: String, default: null })
  mimeType?: string | null;

  @Prop({ type: Number, default: null })
  storedSizeBytes?: number | null;

  @Prop({ type: Object, default: null })
  selectedRange?: { start: number; end: number } | null;

  @Prop({ type: String, default: null })
  rangeSummary?: string | null;

  @Prop({ type: [{ pageNumber: Number, storageKey: String }], default: [] })
  pageImageKeys?: Array<{ pageNumber: number; storageKey: string }>;
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
