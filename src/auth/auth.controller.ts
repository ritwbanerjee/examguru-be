import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Request, Response } from 'express';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ConfigService } from '@nestjs/config';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful.' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const result = await this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined
    });

    // Return both access token and refresh token in response body
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user
    };
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Send password reset email if the user exists' })
  @ApiResponse({ status: 200, description: 'Password reset flow triggered.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using token emailed to the user' })
  @ApiResponse({ status: 200, description: 'Password updated.' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @ApiResponse({ status: 302, description: 'Redirects to Google OAuth consent screen.' })
  async googleAuth() {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({ status: 200, description: 'Returns HTML page that handles token storage.' })
  async googleAuthRedirect(@Req() req: Request & { user: any }, @Res() res: Response) {
    const result = await this.authService.googleLoginCallback(req.user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined
    });

    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    const baseUrl = frontendUrl.replace(/\/$/, '');
    const userPayload = encodeURIComponent(JSON.stringify(result.user));
    const redirectUrl = `${baseUrl}/app/callback?accessToken=${encodeURIComponent(
      result.accessToken
    )}&refreshToken=${encodeURIComponent(result.refreshToken)}&user=${userPayload}`;

    res.redirect(redirectUrl);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token from request body' })
  @ApiResponse({ status: 200, description: 'Access token refreshed.' })
  async refreshToken(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) {
      throw new Error('Refresh token not provided');
    }
    return this.authService.refreshAccessToken(body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Logout user and clear refresh token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully.' })
  async logout(@Req() req: Request & { user: { id: string } }) {
    await this.authService.logout(req.user);
    return { message: 'Logged out successfully.' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Return authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Authenticated user returned.' })
  getProfile(@Req() req: Request & { user: { id: string } }) {
    return this.authService.getProfile(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Update authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @Req() req: Request & { user: { id: string } }
  ) {
    return this.authService.updateProfile(req.user, dto);
  }
}
