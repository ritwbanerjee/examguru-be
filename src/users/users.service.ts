import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  create(data: Partial<User>) {
    if (data.email) {
      data.email = data.email.toLowerCase();
    }
    const user = new this.userModel(data);
    return user.save();
  }

  findByEmail(email: string) {
    return this.userModel.findOne({ email: email?.toLowerCase() }).exec();
  }

  findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  async setResetToken(userId: string, tokenHash: string, expires: Date) {
    await this.userModel.findByIdAndUpdate(userId, {
      resetPasswordToken: tokenHash,
      resetPasswordExpires: expires
    });
  }

  findByResetToken(tokenHash: string) {
    return this.userModel
      .findOne({
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { $gt: new Date() }
      })
      .exec();
  }

  async updatePassword(userId: string, hashedPassword: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      password_hash: hashedPassword,
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined
    });
  }

  async recordLogin(userId: string, meta: { ip?: string; userAgent?: string }) {
    await this.userModel.findByIdAndUpdate(userId, {
      last_login_ip: meta.ip,
      last_user_agent: meta.userAgent,
      last_active_at: new Date()
    });
  }

  async touchActivity(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      last_active_at: new Date()
    });
  }

  async incrementTotalUploads(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { total_uploads: 1 }
    });
  }

  async updateProfile(userId: string, payload: Partial<User>) {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          $set: payload
        },
        { new: true }
      )
      .exec();
  }

  async upsertGoogleUser(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    googleId: string;
    avatarUrl?: string;
  }) {
    const existing = await this.userModel.findOne({ email: data.email.toLowerCase() }).exec();
    if (existing) {
      if (!existing.googleId) {
        existing.googleId = data.googleId;
        existing.auth_provider = 'google';
      }
      if (data.firstName) {
        existing.first_name = data.firstName;
      }
      if (data.lastName) {
        existing.last_name = data.lastName;
      }
      if (data.avatarUrl) {
        existing.avatar_url = data.avatarUrl;
      }
      await existing.save();
      return existing;
    }
    return this.create({
      email: data.email.toLowerCase(),
      first_name: data.firstName,
      last_name: data.lastName,
      auth_provider: 'google',
      email_verified: true,
      avatar_url: data.avatarUrl,
      googleId: data.googleId,
      acceptTerms: true,
      onboarding_completed: true
    });
  }
}
