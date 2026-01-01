import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  // Core Auth
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop()
  password_hash?: string;

  @Prop({ type: [String], default: ['local'] })
  auth_providers!: string[]; // Array to support multiple login methods

  @Prop({ default: false })
  email_verified!: boolean;

  @Prop()
  refresh_token_hash?: string; // Hashed refresh token for security

  @Prop()
  refresh_token_expires_at?: Date; // Refresh token expiration

  // Profile
  @Prop()
  first_name?: string;

  @Prop()
  last_name?: string;

  @Prop()
  avatar_url?: string;

  @Prop()
  phone_number?: string;

  @Prop()
  birthday?: Date;

  @Prop({ default: 'en' })
  preferred_language?: string;

  // Product
  @Prop({ default: false })
  onboarding_completed!: boolean;

  @Prop()
  last_active_at?: Date;

  @Prop({ default: 0 })
  total_uploads!: number;

  // Subscription
  @Prop({ default: 'free' })
  plan?: string;

  @Prop({ default: 'inactive' })
  subscription_status?: string;

  @Prop()
  stripe_customer_id?: string;

  @Prop()
  trial_ends_at?: Date;

  // Security
  @Prop({ default: false })
  mfa_enabled!: boolean;

  @Prop()
  last_login_ip?: string;

  @Prop()
  last_user_agent?: string;

  // Misc
  @Prop()
  googleId?: string;

  @Prop({ default: false })
  acceptTerms!: boolean;

  @Prop()
  resetPasswordToken?: string;

  @Prop()
  resetPasswordExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
