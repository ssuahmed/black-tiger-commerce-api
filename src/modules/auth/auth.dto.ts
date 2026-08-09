import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class IdentifierDto {
  @IsString()
  identifier!: string;

  @IsIn(['login', 'register'])
  intent!: 'login' | 'register';
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(8)
  confirmPassword!: string;

  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
}

export class LoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  challengeId?: string;
}

export class OtpSendDto {
  @IsString()
  challengeId!: string;

  @IsIn(['login', 'register', 'reset_password'])
  purpose!: 'login' | 'register' | 'reset_password';

  /** Mobile OTP channel. Defaults to whatsapp on the server for mobile identifiers. */
  @IsOptional()
  @IsIn(['whatsapp', 'sms', 'email'])
  channel?: 'whatsapp' | 'sms' | 'email';
}

export class OtpResendDto {
  @IsString()
  challengeId!: string;

  @IsOptional()
  @IsIn(['whatsapp', 'sms', 'email'])
  channel?: 'whatsapp' | 'sms' | 'email';
}

export class OtpVerifyDto {
  @IsString()
  challengeId!: string;

  @IsString()
  @MinLength(6)
  code!: string;

  @IsIn(['login', 'register', 'reset_password'])
  purpose!: 'login' | 'register' | 'reset_password';
}

export class ForgotPasswordDto {
  @IsString()
  identifier!: string;

  @IsOptional()
  @IsIn(['auto', 'email_link', 'otp'])
  preferredMethod?: 'auto' | 'email_link' | 'otp';
}

export class PasswordResetDto {
  @IsOptional()
  @IsString()
  resetToken?: string;

  @IsOptional()
  @IsString()
  resetSessionToken?: string;

  @IsOptional()
  @IsString()
  challengeId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(8)
  confirmPassword!: string;

  @IsOptional()
  @IsBoolean()
  autoLogin?: boolean;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
