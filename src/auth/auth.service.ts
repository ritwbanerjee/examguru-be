import { BadRequestException, Injectable, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserDocument } from '../users/schemas/user.schema';
import { StripeService } from '../stripe/stripe.service';

interface AuthContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly passwordSecret: string;
  private readonly forgotResponse = { message: 'If the email exists, a reset link has been sent.' };
  private readonly resetSuccessResponse = { message: 'Password updated successfully.' };

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => StripeService))
    private readonly stripeService: StripeService
  ) {
    if (!process.env.PASSWORD_SECRET) {
      throw new Error('PASSWORD_SECRET is not configured');
    }
    this.passwordSecret = process.env.PASSWORD_SECRET;
  }

  async register(dto: RegisterDto) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('Terms and conditions must be accepted.');
    }
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new BadRequestException('Email already registered.');
    }

    const { firstName, lastName } = this.splitName(dto.name);
    const hashedPassword = await this.hashPassword(dto.password);
    const user = await this.usersService.create({
      email: dto.email.toLowerCase(),
      password_hash: hashedPassword,
      first_name: firstName,
      last_name: lastName,
      auth_providers: ['local'],
      preferred_language: 'en',
      acceptTerms: dto.acceptTerms,
      onboarding_completed: false,
      email_verified: false
    });

    return this.buildUserResponse(user);
  }

  async login(dto: LoginDto, context?: AuthContext) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    const isMatch = await this.comparePassword(dto.password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user);
    await this.usersService.recordLogin(user.id, {
      ip: context?.ip,
      userAgent: context?.userAgent
    });
    return {
      accessToken,
      refreshToken,
      user: this.buildUserResponse(user)
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      return this.forgotResponse;
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(token);
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    await this.usersService.setResetToken(user.id, tokenHash, expires);
    // Normally email would be sent with token-based link. Log for local debugging only.
    console.info(`[auth] Password reset token for ${user.email}: ${token}`);
    return this.forgotResponse;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashResetToken(dto.token);
    const user = await this.usersService.findByResetToken(tokenHash);
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token.');
    }
    const hashedPassword = await this.hashPassword(dto.password);
    await this.usersService.updatePassword(user.id, hashedPassword);
    return this.resetSuccessResponse;
  }

  async changePassword(user: { id: string }, dto: ChangePasswordDto) {
    const existing = await this.usersService.findById(user.id);
    if (!existing) {
      throw new UnauthorizedException();
    }
    if (!existing.password_hash) {
      throw new BadRequestException('Password login is not enabled for this account.');
    }
    const matches = await this.comparePassword(dto.currentPassword, existing.password_hash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    const samePassword = await this.comparePassword(dto.newPassword, existing.password_hash);
    if (samePassword) {
      throw new BadRequestException('New password must be different from the current password.');
    }
    const hashedPassword = await this.hashPassword(dto.newPassword);
    await this.usersService.updatePassword(existing.id, hashedPassword);
    return { message: 'Password updated successfully.' };
  }

  async getProfile(user: { id: string }) {
    const existing = await this.usersService.findById(user.id);
    if (!existing) {
      throw new UnauthorizedException();
    }
    await this.usersService.touchActivity(existing.id);
    return this.buildUserResponse(existing);
  }

  async googleLoginCallback(googleUser: any, context?: AuthContext) {
    // googleUser comes from Passport Google Strategy
    const { googleId, email, firstName, lastName, avatarUrl } = googleUser;

    const user = await this.usersService.upsertGoogleUser({
      email: email.toLowerCase(),
      firstName,
      lastName,
      googleId,
      avatarUrl
    });

    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user);

    await this.usersService.recordLogin(user.id, {
      ip: context?.ip,
      userAgent: context?.userAgent
    });

    return {
      accessToken,
      refreshToken,
      user: this.buildUserResponse(user)
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const user = await this.usersService.findByRefreshToken(tokenHash);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    const newAccessToken = await this.generateAccessToken(user);
    return {
      accessToken: newAccessToken,
      user: this.buildUserResponse(user)
    };
  }

  async logout(user: { id: string }) {
    await this.usersService.clearRefreshToken(user.id);
    return { message: 'Logged out successfully.' };
  }

  async updateProfile(user: { id: string }, dto: UpdateProfileDto) {
    const payload: any = {};
    if (dto.firstName !== undefined) {
      payload.first_name = dto.firstName?.trim();
    }
    if (dto.lastName !== undefined) {
      payload.last_name = dto.lastName?.trim();
    }
    if (dto.phoneNumber !== undefined) {
      payload.phone_number = dto.phoneNumber?.trim();
    }
    if (dto.birthday !== undefined) {
      payload.birthday = dto.birthday ? new Date(dto.birthday) : null;
    }
    const updated = await this.usersService.updateProfile(user.id, payload);
    if (!updated) {
      throw new UnauthorizedException();
    }
    return this.buildUserResponse(updated);
  }

  private async hashPassword(password: string) {
    return bcrypt.hash(password + this.passwordSecret, 12);
  }

  private comparePassword(password: string, hashed: string) {
    return bcrypt.compare(password + this.passwordSecret, hashed);
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token + this.passwordSecret).digest('hex');
  }

  private buildUserResponse(user: UserDocument) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
      fullName: this.composeName(user),
      avatarUrl: user.avatar_url ?? null,
      phoneNumber: user.phone_number ?? null,
      birthday: user.birthday ? user.birthday.toISOString() : null,
      authProvider: user.auth_providers,
      emailVerified: user.email_verified,
      plan: user.plan,
      subscriptionStatus: user.subscription_status,
      onboardingCompleted: user.onboarding_completed,
      totalUploads: user.total_uploads
    };
  }

  private async generateAccessToken(user: UserDocument) {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email
      },
      { expiresIn: '1h' } // 1 hour as per user preference
    );
  }

  private async generateRefreshToken(user: UserDocument) {
    const token = randomBytes(64).toString('hex');
    const tokenHash = this.hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await this.usersService.setRefreshToken(user.id, tokenHash, expiresAt);
    return token;
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token + this.passwordSecret).digest('hex');
  }

  private splitName(fullName?: string) {
    if (!fullName) {
      return { firstName: undefined, lastName: undefined };
    }
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts.shift();
    const lastName = parts.length ? parts.join(' ') : undefined;
    return { firstName, lastName };
  }

  private composeName(user: UserDocument) {
    const first = user.first_name?.trim() ?? '';
    const last = user.last_name?.trim() ?? '';
    const combined = `${first} ${last}`.trim();
    if (combined) {
      return combined;
    }
    return user.email?.split('@')[0] ?? 'User';
  }

  /**
   * Delete user account and cancel Stripe subscription
   */
  async deleteAccount(userId: string) {
    // First, cancel and delete Stripe subscription and customer
    await this.stripeService.cancelSubscriptionOnAccountDeletion(userId);

    // Then delete the user from database
    await this.usersService.deleteUser(userId);

    return {
      message: 'Account deleted successfully. Your subscription has been cancelled and you will not be charged again.'
    };
  }
}
