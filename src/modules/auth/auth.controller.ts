/**
 * Auth HTTP surface for the storefront: identifier challenge, register/login,
 * OTP send/verify, password forgot/reset, refresh, and logout.
 *
 * Most routes are `@Public()`; logout requires a valid access token.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import {
  ForgotPasswordDto,
  IdentifierDto,
  LoginDto,
  OtpResendDto,
  OtpSendDto,
  OtpVerifyDto,
  PasswordResetDto,
  RefreshDto,
  RegisterDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('password/policy')
  getPasswordPolicy() {
    return this.auth.getPasswordPolicy();
  }

  @Public()
  @Post('identifier')
  submitIdentifier(@Body() dto: IdentifierDto) {
    return this.auth.submitIdentifier(dto);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('otp/send')
  sendOtp(@Body() dto: OtpSendDto) {
    return this.auth.sendOtp(dto);
  }

  @Public()
  @Post('otp/resend')
  resendOtp(@Body() dto: OtpResendDto) {
    return this.auth.resendOtp(dto);
  }

  @Public()
  @Post('otp/verify')
  async verifyOtp(@Body() dto: OtpVerifyDto) {
    const result = await this.auth.verifyOtp(dto);
    if (result.kind === 'reset') {
      return result.data;
    }
    return result.data;
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Get('password/reset/validate')
  validateResetToken(@Query('token') token: string) {
    return this.auth.validateResetToken(token);
  }

  @Public()
  @Post('password/reset')
  resetPassword(@Body() dto: PasswordResetDto) {
    return this.auth.resetPassword(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request) {
    const user = req.user;
    if (user) {
      this.auth.logout(user.sub);
    }
  }
}
