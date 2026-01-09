import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChapterDocument = Chapter & Document;

@Schema({
  timestamps: true,
  collection: 'chapters',
})
export class Chapter {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: 60,
  })
  name!: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ChapterSchema = SchemaFactory.createForClass(Chapter);

// Compound index for unique chapter names per user (case-insensitive)
ChapterSchema.index({ userId: 1, name: 1 }, { unique: true });
