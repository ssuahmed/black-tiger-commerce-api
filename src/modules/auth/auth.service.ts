import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { newId } from '../../common/utils/uuid';
import {
  ACCESS_TOKEN_EXPIRY_SEC,
  OTP_COOLDOWN_SEC,
  OTP_EXPIRY_SEC,
  REFRESH_TOKEN_EXPIRY_SEC,
  RESET_SESSION_EXPIRY_SEC,
} from '../../common/constants';
import {
  hashPassword,
  verifyPassword,
} from '../../common/utils/crypto-password';
import { MailService } from '../../infrastructure/mail/mail.service';
import { OdooCustomerService } from '../../infrastructure/odoo/odoo-customer.service';
import {
  PersistenceService,
  type StoredUser,
} from '../../persistence/persistence.service';
import type { JwtPayload } from './auth.types';
import type {
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly odooCustomers: OdooCustomerService,
    private readonly mail: MailService,
  ) {}

  private generateOtpCode(): string {
    // Stable code in development so local smoke/e2e stay simple; still emailed.
    if (this.config.get<string>('NODE_ENV') === 'development') {
      return '123456';
    }
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  private async deliverOtp(
    ch: {
      identifier: string;
      identifierType: 'email' | 'mobile';
    },
    purpose: 'login' | 'register' | 'reset_password',
    code: string,
  ): Promise<void> {
    if (ch.identifierType !== 'email') {
      this.logger.warn(
        `OTP for mobile ${this.maskIdentifier(ch.identifier, 'mobile')} — SMS not configured; code logged in development only`,
      );
      if (this.config.get<string>('NODE_ENV') === 'development') {
        this.logger.log(`Dev OTP (mobile): ${code}`);
      }
      return;
    }
    if (!this.mail.isConfigured()) {
      this.logger.warn(
        `SMTP not configured — OTP for ${this.maskIdentifier(ch.identifier, 'email')} not emailed`,
      );
      if (this.config.get<string>('NODE_ENV') === 'development') {
        this.logger.log(`Dev OTP (email): ${code}`);
      }
      return;
    }
    try {
      await this.mail.sendOtpEmail({
        to: ch.identifier,
        code,
        purpose,
        expiresInSeconds: OTP_EXPIRY_SEC,
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        'Unable to send verification email. Please try again shortly.',
      );
    }
  }

  /** Create local user + sync ``res.partner`` when Odoo is live. */
  private async persistNewUser(input: {
    email: string;
    passwordHash: string;
    displayName?: string;
    phone?: string;
  }): Promise<StoredUser> {
    const emailKey = input.email.toLowerCase();
    const user: StoredUser = {
      id: newId(),
      email: input.email,
      passwordHash: input.passwordHash,
      segment: 'b2c',
      approvalStatus: null,
      displayName: input.displayName ?? input.email.split('@')[0],
      phone: input.phone,
    };

    if (this.odooCustomers.isLive()) {
      try {
        const partnerId = await this.odooCustomers.ensureStorefrontSignup({
          email: user.email,
          name: user.displayName,
          phone: user.phone,
          segment: 'b2c',
          approvalStatus: 'approved',
        });
        if (partnerId) {
          user.odooPartnerId = partnerId;
        }
      } catch (err) {
        this.logger.error(
          `Failed to persist signup to Odoo for ${user.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Unable to create customer account in Odoo. Please try again.',
        );
      }
    }

    this.persistence.usersById.set(user.id, user);
    this.persistence.usersByEmail.set(emailKey, user.id);
    this.persistence.notificationPrefs.set(user.id, {
      orderUpdates: true,
      promotions: false,
      creditAlerts: true,
      smsEnabled: false,
    });
    this.persistence.creditsLedger.set(user.id, {
      balanceAmount: 0,
      currency: 'SAR',
    });
    return user;
  }

  private isDevOtp(code: string): boolean {
    return (
      this.config.get<string>('NODE_ENV') === 'development' &&
      code === '123456'
    );
  }

  getPasswordPolicy() {
    return {
      rules: [
        {
          code: 'MIN_LENGTH',
          label: 'At least 8 characters',
          required: true,
        },
        {
          code: 'SPECIAL_CHAR',
          label: 'One special character',
          required: true,
        },
        {
          code: 'MIXED_CASE',
          label: 'Upper and lower case letters',
          required: true,
        },
        { code: 'DIGIT', label: 'One number', required: true },
      ],
    };
  }

  private maskIdentifier(
    identifier: string,
    type: 'email' | 'mobile',
  ): string {
    if (type === 'mobile') {
      return `***${identifier.slice(-4)}`;
    }
    const [user, domain] = identifier.split('@');
    if (!user || !domain) {
      return '***';
    }
    const vis =
      user.length <= 3 ? `${user[0]}***` : `${user[0]}***${user.slice(-2)}`;
    return `${vis}@${domain}`;
  }

  private detectType(id: string): 'email' | 'mobile' {
    return id.includes('@') ? 'email' : 'mobile';
  }

  submitIdentifier(dto: IdentifierDto) {
    const identifier = dto.identifier.trim();
    const type = this.detectType(identifier);
    const key = type === 'email' ? identifier.toLowerCase() : identifier;
    const exists = this.persistence.usersByEmail.has(key);
    const challengeId = newId();

    if (dto.intent === 'register') {
      if (exists) {
        this.persistence.authChallenges.set(challengeId, {
          challengeId,
          identifier: key,
          identifierType: type,
          intent: 'login',
        });
        return {
          nextStep: 'login_method' as const,
          availableMethods: ['otp', 'password'] as const,
          challengeId,
          maskedDestination: this.maskIdentifier(identifier, type),
          destinationType:
            type === 'email' ? ('email' as const) : ('sms' as const),
          identifierType: type,
        };
      }
      this.persistence.authChallenges.set(challengeId, {
        challengeId,
        identifier: key,
        identifierType: type,
        intent: 'register',
      });
      return {
        nextStep: 'register_form' as const,
        challengeId,
        maskedDestination: this.maskIdentifier(identifier, type),
        destinationType:
          type === 'email' ? ('email' as const) : ('sms' as const),
        identifierType: type,
      };
    }

    this.persistence.authChallenges.set(challengeId, {
      challengeId,
      identifier: key,
      identifierType: type,
      intent: 'login',
    });
    return {
      nextStep: 'login_method' as const,
      availableMethods: ['otp', 'password'] as const,
      challengeId,
      maskedDestination: this.maskIdentifier(identifier, type),
      destinationType: type === 'email' ? ('email' as const) : ('sms' as const),
      identifierType: type,
    };
  }

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    const email = dto.email.toLowerCase();
    if (this.persistence.usersByEmail.has(email)) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.persistNewUser({
      email: dto.email,
      passwordHash: hashPassword(dto.password),
      displayName: dto.email.split('@')[0],
    });
    return this.buildAuthTokens(user);
  }

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const type = this.detectType(identifier);
    const key = type === 'email' ? identifier.toLowerCase() : identifier;
    const userId = this.persistence.usersByEmail.get(key);
    if (!userId) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (dto.challengeId) {
      const ch = this.persistence.authChallenges.get(dto.challengeId);
      if (!ch || ch.identifier !== key || ch.intent !== 'login') {
        throw new UnauthorizedException('Invalid credentials');
      }
    }
    const user = this.persistence.usersById.get(userId);
    if (!user || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.buildAuthTokens(user);
  }

  async sendOtp(dto: OtpSendDto) {
    const ch = this.persistence.authChallenges.get(dto.challengeId);
    if (!ch) {
      throw new BadRequestException('Invalid challenge');
    }
    const now = Date.now();
    if (
      ch.lastOtpSentAt &&
      now - ch.lastOtpSentAt < OTP_COOLDOWN_SEC * 1000
    ) {
      throw new HttpException('Resend too soon', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = this.generateOtpCode();
    ch.otpCode = code;
    ch.otpExpiresAt = now + OTP_EXPIRY_SEC * 1000;
    ch.lastOtpSentAt = now;
    this.persistence.authChallenges.set(dto.challengeId, ch);
    await this.deliverOtp(ch, dto.purpose, code);
    return {
      challengeId: dto.challengeId,
      expiresInSeconds: OTP_EXPIRY_SEC,
      resendAvailableInSeconds: OTP_COOLDOWN_SEC,
      maskedDestination: this.maskIdentifier(ch.identifier, ch.identifierType),
      destinationType:
        ch.identifierType === 'email' ? ('email' as const) : ('sms' as const),
    };
  }

  async resendOtp(dto: OtpResendDto) {
    const ch = this.persistence.authChallenges.get(dto.challengeId);
    if (!ch) {
      throw new BadRequestException('Invalid challenge');
    }
    const now = Date.now();
    if (
      ch.lastOtpSentAt &&
      now - ch.lastOtpSentAt < OTP_COOLDOWN_SEC * 1000
    ) {
      const left = Math.ceil(
        OTP_COOLDOWN_SEC - (now - ch.lastOtpSentAt) / 1000,
      );
      throw new HttpException(
        `Cooldown active (${left}s remaining)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const purpose = ch.resetPurpose
      ? ('reset_password' as const)
      : ch.intent === 'register'
        ? ('register' as const)
        : ('login' as const);
    const code = this.generateOtpCode();
    ch.otpCode = code;
    ch.otpExpiresAt = now + OTP_EXPIRY_SEC * 1000;
    ch.lastOtpSentAt = now;
    this.persistence.authChallenges.set(dto.challengeId, ch);
    await this.deliverOtp(ch, purpose, code);
    return {
      challengeId: dto.challengeId,
      expiresInSeconds: OTP_EXPIRY_SEC,
      resendAvailableInSeconds: OTP_COOLDOWN_SEC,
      maskedDestination: this.maskIdentifier(ch.identifier, ch.identifierType),
      destinationType:
        ch.identifierType === 'email' ? ('email' as const) : ('sms' as const),
    };
  }

  async verifyOtp(dto: OtpVerifyDto) {
    const ch = this.persistence.authChallenges.get(dto.challengeId);
    if (!ch) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    const otpOk =
      !!(
        ch.otpExpiresAt &&
        Date.now() < ch.otpExpiresAt &&
        ch.otpCode === dto.code
      ) || this.isDevOtp(dto.code);
    if (!otpOk) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (dto.purpose === 'reset_password') {
      const lookup =
        ch.identifierType === 'email'
          ? ch.identifier.toLowerCase()
          : ch.identifier;
      const userId = this.persistence.usersByEmail.get(lookup);
      if (!userId) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      const token = newId();
      this.persistence.resetSessions.set(token, {
        userId,
        expiresAt: Date.now() + RESET_SESSION_EXPIRY_SEC * 1000,
      });
      return {
        kind: 'reset' as const,
        data: {
          resetSessionToken: token,
          expiresInSeconds: RESET_SESSION_EXPIRY_SEC,
        },
      };
    }

    if (dto.purpose === 'register') {
      if (ch.intent !== 'register') {
        throw new BadRequestException('Invalid flow');
      }
      const emailKey =
        ch.identifierType === 'email'
          ? ch.identifier.toLowerCase()
          : `${ch.identifier}.mobile@blacktiger.local`;
      const displayEmail =
        ch.identifierType === 'email' ? ch.identifier : emailKey;
      if (this.persistence.usersByEmail.has(emailKey)) {
        throw new ConflictException('Email already registered');
      }
      const user = await this.persistNewUser({
        email: displayEmail,
        passwordHash: hashPassword(newId()),
        displayName: displayEmail.split('@')[0],
        phone: ch.identifierType === 'mobile' ? ch.identifier : undefined,
      });
      const tokens = await this.buildAuthTokens(user);
      return { kind: 'tokens' as const, data: tokens };
    }

    const lookup =
      ch.identifierType === 'email'
        ? ch.identifier.toLowerCase()
        : ch.identifier;
    const userId = this.persistence.usersByEmail.get(lookup);
    const user = userId ? this.persistence.usersById.get(userId) : undefined;
    if (!user) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    const tokens = await this.buildAuthTokens(user);
    return { kind: 'tokens' as const, data: tokens };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const id = dto.identifier.trim();
    const type = this.detectType(id);
    const key = type === 'email' ? id.toLowerCase() : id;
    const userId = this.persistence.usersByEmail.get(key);
    const method =
      dto.preferredMethod === 'otp'
        ? ('otp' as const)
        : dto.preferredMethod === 'email_link'
          ? ('email_link' as const)
          : type === 'email'
            ? ('email_link' as const)
            : ('otp' as const);

    if (!userId) {
      return {
        message: 'If an account exists, instructions have been sent.',
        deliveryMethod: method,
        maskedDestination: null,
        challengeId: null,
      };
    }

    if (method === 'otp') {
      const challengeId = newId();
      const code = this.generateOtpCode();
      const now = Date.now();
      this.persistence.authChallenges.set(challengeId, {
        challengeId,
        identifier: key,
        identifierType: type,
        intent: 'login',
        resetPurpose: true,
        otpCode: code,
        otpExpiresAt: now + OTP_EXPIRY_SEC * 1000,
        lastOtpSentAt: now,
      });
      const user = this.persistence.usersById.get(userId);
      await this.deliverOtp(
        {
          identifier: user?.email ?? key,
          identifierType: type === 'email' ? 'email' : 'mobile',
        },
        'reset_password',
        code,
      );
      return {
        message: 'If an account exists, instructions have been sent.',
        deliveryMethod: 'otp' as const,
        maskedDestination: this.maskIdentifier(id, type),
        challengeId,
      };
    }

    const token = newId();
    const expiresInSeconds = 3600;
    this.persistence.resetTokens.set(token, {
      userId,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
    const storefront = (
      this.config.get<string>('STOREFRONT_URL') || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const resetUrl = `${storefront}/reset-password?token=${encodeURIComponent(token)}`;
    const user = this.persistence.usersById.get(userId);
    if (user?.email && this.mail.isConfigured()) {
      try {
        await this.mail.sendPasswordResetLink({
          to: user.email,
          resetUrl,
          expiresInSeconds,
        });
      } catch {
        throw new ServiceUnavailableException(
          'Unable to send password reset email. Please try again shortly.',
        );
      }
    } else if (this.config.get<string>('NODE_ENV') === 'development') {
      this.logger.log(`Dev password reset URL: ${resetUrl}`);
    }
    return {
      message: 'If an account exists, instructions have been sent.',
      deliveryMethod: 'email_link' as const,
      maskedDestination: this.maskIdentifier(id, type),
      challengeId: null,
    };
  }

  validateResetToken(token: string) {
    const row = this.persistence.resetTokens.get(token);
    if (!row || row.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired token');
    }
    const user = this.persistence.usersById.get(row.userId);
    return {
      valid: true,
      expiresInSeconds: Math.max(
        0,
        Math.floor((row.expiresAt - Date.now()) / 1000),
      ),
      maskedDestination: user
        ? this.maskIdentifier(user.email, 'email')
        : '***',
    };
  }

  async resetPassword(dto: PasswordResetDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    let userId: string | undefined;

    if (dto.resetToken) {
      const row = this.persistence.resetTokens.get(dto.resetToken);
      if (!row || row.expiresAt < Date.now()) {
        throw new UnauthorizedException('Invalid token, OTP, or session');
      }
      userId = row.userId;
      this.persistence.resetTokens.delete(dto.resetToken);
    } else if (dto.resetSessionToken) {
      const row = this.persistence.resetSessions.get(dto.resetSessionToken);
      if (!row || row.expiresAt < Date.now()) {
        throw new UnauthorizedException('Invalid token, OTP, or session');
      }
      userId = row.userId;
      this.persistence.resetSessions.delete(dto.resetSessionToken);
    } else if (dto.challengeId && dto.code) {
      const ch = this.persistence.authChallenges.get(dto.challengeId);
      const otpOk =
        !!(
          ch &&
          ch.otpExpiresAt &&
          Date.now() < ch.otpExpiresAt &&
          ch.otpCode === dto.code
        ) || !!(ch && this.isDevOtp(dto.code));
      if (!ch || !otpOk) {
        throw new UnauthorizedException('Invalid token, OTP, or session');
      }
      const lookup =
        ch.identifierType === 'email'
          ? ch.identifier.toLowerCase()
          : ch.identifier;
      userId = this.persistence.usersByEmail.get(lookup);
    }

    if (!userId) {
      throw new BadRequestException('Missing reset credentials');
    }
    const user = this.persistence.usersById.get(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid token, OTP, or session');
    }
    user.passwordHash = hashPassword(dto.password);
    const autoLogin = dto.autoLogin !== false;
    const tokens = autoLogin ? await this.buildAuthTokens(user) : undefined;
    return {
      message: 'Password updated successfully.',
      tokens,
    };
  }

  async refresh(dto: RefreshDto) {
    const secret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    let decoded: { sub: string; jti?: string; type?: string };
    try {
      decoded = await this.jwt.verifyAsync(dto.refreshToken, {
        secret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (decoded.type !== 'refresh' || !decoded.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const row = this.persistence.refreshTokens.get(decoded.jti);
    if (!row || row.revoked || row.userId !== decoded.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    row.revoked = true;
    const user = this.persistence.usersById.get(decoded.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.buildAuthTokens(user);
  }

  logout(userId: string) {
    for (const rec of this.persistence.refreshTokens.values()) {
      if (rec.userId === userId) {
        rec.revoked = true;
      }
    }
  }

  private async buildAuthTokens(user: StoredUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      segment: user.segment,
      approvalStatus: user.approvalStatus,
    };
    const accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const accessToken = await this.jwt.signAsync(payload, {
      secret: accessSecret,
      expiresIn: ACCESS_TOKEN_EXPIRY_SEC,
    });
    const jti = newId();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh', jti },
      { secret: refreshSecret, expiresIn: REFRESH_TOKEN_EXPIRY_SEC },
    );
    this.persistence.refreshTokens.set(jti, {
      userId: user.id,
      revoked: false,
    });
    const authUser = {
      id: user.id,
      email: user.email,
      phone: user.phone ?? null,
      segment: user.segment,
      approvalStatus: user.approvalStatus,
      displayName: user.displayName ?? user.email,
    };
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SEC,
      tokenType: 'Bearer' as const,
      user: authUser,
    };
  }
}
