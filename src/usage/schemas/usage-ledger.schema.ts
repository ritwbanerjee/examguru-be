import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type UsageLedgerDocument = HydratedDocument<UsageLedger>;

@Schema({ timestamps: true })
export class UsageLedger {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ required: true })
  year!: number;

  @Prop({ required: true })
  month!: number;

  @Prop({ default: 0 })
  runsUsed!: number;

  @Prop({ default: 0 })
  pagesProcessed!: number;

  @Prop({ default: 0 })
  ocrPagesProcessed!: number;

  @Prop({ default: 0 })
  visionImagesProcessed!: number;

  @Prop({ default: 0 })
  visionUnitsProcessed!: number;

  @Prop({ default: 0 })
  inputTokens!: number;

  @Prop({ default: 0 })
  outputTokens!: number;

  @Prop({ default: 0 })
  totalTokens!: number;
}

export const UsageLedgerSchema = SchemaFactory.createForClass(UsageLedger);
UsageLedgerSchema.index({ user: 1, year: 1, month: 1 }, { unique: true });
