/**
 * Storefront authentication: identifier challenge, password login/register,
 * OTP (email / WhatsApp / SMS stub), password reset, JWT access+refresh.
 *
 * Live mode uses Odoo `res.partner` as credential SSOT via
 * {@link OdooCustomerService}; session users are cached ephemerally in
 * {@link PersistenceService}. OTP delivery uses SMTP mail and Meta WhatsApp Cloud.
 */
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
  partnerAccountId,
  parsePartnerAccountId,
} from '../../common/utils/account-identity';
import {
  hashPassword,
  verifyPassword,
} from '../../common/utils/crypto-password';
import { MailService } from '../../infrastructure/mail/mail.service';
import {
  OdooCustomerService,
  type StorefrontAuthProfile,
} from '../../infrastructure/odoo/odoo-customer.service';
import { WhatsAppCloudService } from '../../infrastructure/whatsapp/whatsapp-cloud.service';
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

type OtpChannel = 'email' | 'sms' | 'whatsapp';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly odooCustomers: OdooCustomerService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppCloudService,
  ) {}

  private isLiveAuth(): boolean {
    return this.odooCustomers.isLive();
  }

  private generateOtpCode(): string {
    // Stable code when USE_MOCK_OTP or WHATSAPP_SEND_HELLO_FOR_TEST is on.
    if (this.useFixedOtp()) {
      return '123456';
    }
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  /** Email identifiers always use email; mobile defaults to WhatsApp. */
  private resolveOtpChannel(
    identifierType: 'email' | 'mobile',
    requested?: OtpChannel,
  ): OtpChannel {
    if (identifierType === 'email') return 'email';
    if (requested === 'sms' || requested === 'whatsapp') return requested;
    // Mobile default: WhatsApp first
    return 'whatsapp';
  }

  /** Deliver OTP via SMTP, WhatsApp Cloud, or SMS stub (mock logs when unconfigured). */
  private async deliverOtp(
    ch: {
      identifier: string;
      identifierType: 'email' | 'mobile';
    },
    purpose: 'login' | 'register' | 'reset_password',
    code: string,
    channel: OtpChannel,
  ): Promise<void> {
    if (channel === 'email' || ch.identifierType === 'email') {
      if (!this.mail.isConfigured()) {
        this.logger.warn(
          `SMTP not configured — OTP for ${this.maskIdentifier(ch.identifier, 'email')} not emailed`,
        );
        if (this.useMockOtp()) {
          this.logger.log(`Mock OTP (email): ${code}`);
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
      return;
    }

    if (channel === 'whatsapp') {
      try {
        await this.whatsapp.sendOtp({
          to: ch.identifier,
          code,
          purpose,
        });
      } catch {
        throw new ServiceUnavailableException(
          'Unable to send verification code on WhatsApp. Please try again shortly.',
        );
      }
      return;
    }

    // SMS channel — provider not wired yet; stub like WhatsApp when unconfigured
    this.logger.warn(
      `OTP for mobile ${this.maskIdentifier(ch.identifier, 'mobile')} — SMS not configured; code logged when USE_MOCK_OTP is enabled`,
    );
    if (this.useMockOtp()) {
      this.logger.log(`Mock OTP (sms): ${code}`);
    }
  }

  private authProfileToUser(
    profile: StorefrontAuthProfile,
    emailFallback?: string,
  ): StoredUser {
    const email = (profile.email || emailFallback || '').trim();
    if (!profile.partnerId || !email) {
      throw new ServiceUnavailableException(
        'Odoo auth profile is missing partner identity.',
      );
    }
    const id = partnerAccountId(profile.partnerId);
    return {
      id,
      email,
      segment: profile.segment ?? 'b2c',
      approvalStatus: profile.approvalStatus ?? null,
      displayName: profile.name ?? email.split('@')[0],
      phone: profile.phone ? String(profile.phone) : undefined,
      odooPartnerId: profile.partnerId,
    };
  }

  private cacheFromProfile(
    profile: StorefrontAuthProfile,
    emailFallback?: string,
  ): StoredUser {
    const user = this.authProfileToUser(profile, emailFallback);
    this.persistence.cacheSessionUser(user);
    return user;
  }

  /** Hydrate ephemeral session user after JWT validation (API restart safe). */
  async ensureSessionUser(payload: JwtPayload): Promise<void> {
    if (this.persistence.usersById.has(payload.sub)) {
      return;
    }

    // Always restore a minimal session from the JWT so account routes work even
    // when Odoo hydrate fails (e.g. B2B company partner without email on file).
    if (payload.email) {
      this.persistence.cacheSessionUser({
        id: payload.sub,
        email: payload.email,
        segment: payload.segment ?? 'b2c',
        approvalStatus: payload.approvalStatus ?? null,
        displayName: payload.email.split('@')[0],
        odooPartnerId:
          payload.odooPartnerId ?? parsePartnerAccountId(payload.sub) ?? undefined,
      });
    }

    if (!this.isLiveAuth()) {
      return;
    }
    try {
      const partnerId =
        parsePartnerAccountId(payload.sub) ?? payload.odooPartnerId ?? undefined;
      const profile = await this.odooCustomers.getAuthProfile(
        partnerId ? { partnerId } : { email: payload.email },
      );
      if (profile.ok && profile.partnerId) {
        const user = this.authProfileToUser(profile, payload.email);
        // Keep JWT ``sub`` as the cache key so account lookups match the token.
        this.persistence.cacheSessionUser({ ...user, id: payload.sub });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to hydrate session user ${payload.sub}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Create fixture user, or register durable credentials in Odoo when live. */
  private async persistNewUser(input: {
    email: string;
    passwordHash: string;
    displayName?: string;
    phone?: string;
  }): Promise<StoredUser> {
    const emailKey = input.email.toLowerCase();

    if (this.isLiveAuth()) {
      try {
        const profile = await this.odooCustomers.storefrontRegister({
          email: input.email,
          name: input.displayName ?? input.email.split('@')[0],
          phone: input.phone,
          passwordHash: input.passwordHash,
          segment: 'b2c',
          approvalStatus: 'approved',
        });
        if (!profile.ok) {
          if (profile.reason === 'already_registered') {
            throw new ConflictException('Email already registered');
          }
          throw new ServiceUnavailableException(
            `Unable to create customer account in Odoo (${profile.reason || 'unknown'}).`,
          );
        }
        return this.cacheFromProfile(profile);
      } catch (err) {
        if (
          err instanceof ConflictException ||
          err instanceof ServiceUnavailableException
        ) {
          throw err;
        }
        this.logger.error(
          `Failed to persist signup to Odoo for ${input.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Unable to create customer account in Odoo. Please try again.',
        );
      }
    }

    const user: StoredUser = {
      id: newId(),
      email: input.email,
      passwordHash: input.passwordHash,
      segment: 'b2c',
      approvalStatus: null,
      displayName: input.displayName ?? input.email.split('@')[0],
      phone: input.phone,
    };
    this.persistence.cacheSessionUser(user);
    return user;
  }

  private async userExists(identifierKey: string): Promise<boolean> {
    if (this.isLiveAuth()) {
      try {
        const row = await this.odooCustomers.storefrontUserExists(identifierKey);
        return row.exists;
      } catch (err) {
        this.logger.error(
          `Odoo user exists check failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Unable to verify account with Odoo. Please try again.',
        );
      }
    }
    return this.persistence.usersByEmail.has(identifierKey);
  }

  private async findFixtureUserByIdentifier(
    key: string,
  ): Promise<StoredUser | undefined> {
    const userId = this.persistence.usersByEmail.get(key);
    return userId ? this.persistence.usersById.get(userId) : undefined;
  }

  private async findUserByIdentifier(
    key: string,
  ): Promise<StoredUser | undefined> {
    if (this.isLiveAuth()) {
      try {
        const profile = await this.odooCustomers.getAuthProfile({ email: key });
        if (profile.ok && profile.partnerId && profile.storefrontEnabled !== false) {
          return this.cacheFromProfile(profile);
        }
        // Also accept partners that exist via storefrontUserExists + profile
        const exists = await this.odooCustomers.storefrontUserExists(key);
        if (exists.exists && exists.email) {
          const again = await this.odooCustomers.getAuthProfile({
            email: exists.email,
          });
          if (again.ok && again.partnerId) {
            return this.cacheFromProfile(again);
          }
        }
        return undefined;
      } catch (err) {
        this.logger.error(
          `Odoo profile lookup failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Unable to load account from Odoo. Please try again.',
        );
      }
    }
    return this.findFixtureUserByIdentifier(key);
  }

  private isDevMode(): boolean {
    const env =
      this.config.get<string>('NODE_ENV') || process.env.NODE_ENV || '';
    return env === 'development' || env === 'dev';
  }

  /** When true, OTP is fixed to 123456 and accepted as a mock bypass. */
  private useMockOtp(): boolean {
    return this.envFlag('USE_MOCK_OTP');
  }

  /** Hello-world WhatsApp probe still pins OTP to 123456 with USE_MOCK_OTP off. */
  private useFixedOtp(): boolean {
    return this.useMockOtp() || this.whatsapp.sendHelloForTest();
  }

  private envFlag(key: string): boolean {
    const raw = (this.config.get<string>(key) ?? process.env[key] ?? '')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private isMockOtp(code: string): boolean {
    return this.useFixedOtp() && String(code || '').trim() === '123456';
  }

  /** Password complexity rules exposed to the storefront signup/reset UI. */
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

  /**
   * Auth entry: email/mobile + login|register intent → next step + challengeId.
   * Existing users registering are redirected to the login-method step.
   */
  async submitIdentifier(dto: IdentifierDto) {
    const identifier = dto.identifier.trim();
    const type = this.detectType(identifier);
    const key = type === 'email' ? identifier.toLowerCase() : identifier;
    const exists = await this.userExists(key);
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
            type === 'email' ? ('email' as const) : ('whatsapp' as const),
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
          type === 'email' ? ('email' as const) : ('whatsapp' as const),
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
      destinationType: type === 'email' ? ('email' as const) : ('whatsapp' as const),
      identifierType: type,
    };
  }

  /** Password register path: create partner in Odoo (or fixture) and issue JWTs. */
  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    const email = dto.email.toLowerCase();
    if (await this.userExists(email)) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.persistNewUser({
      email: dto.email,
      passwordHash: hashPassword(dto.password),
      displayName: dto.email.split('@')[0],
    });
    return this.buildAuthTokens(user);
  }

  /** Password login against Odoo authenticate RPC (or local fixture hash). */
  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const type = this.detectType(identifier);
    const key = type === 'email' ? identifier.toLowerCase() : identifier;
    if (dto.challengeId) {
      const ch = this.persistence.authChallenges.get(dto.challengeId);
      if (!ch || ch.identifier !== key || ch.intent !== 'login') {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    if (this.isLiveAuth()) {
      if (type !== 'email') {
        // Mobile password login: resolve email via existence RPC when possible
        const exists = await this.odooCustomers.storefrontUserExists(key);
        if (!exists.exists || !exists.email) {
          throw new UnauthorizedException('Invalid credentials');
        }
        const profile = await this.odooCustomers.storefrontAuthenticate({
          email: exists.email,
          password: dto.password,
        });
        if (!profile.ok) {
          throw new UnauthorizedException('Invalid credentials');
        }
        return this.buildAuthTokens(this.cacheFromProfile(profile));
      }
      try {
        const profile = await this.odooCustomers.storefrontAuthenticate({
          email: key,
          password: dto.password,
        });
        if (!profile.ok) {
          throw new UnauthorizedException('Invalid credentials');
        }
        return this.buildAuthTokens(this.cacheFromProfile(profile));
      } catch (err) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        this.logger.error(
          `Odoo authenticate failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Unable to authenticate with Odoo. Please try again.',
        );
      }
    }

    const user = await this.findFixtureUserByIdentifier(key);
    if (!user || !user.passwordHash || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.buildAuthTokens(user);
  }

  /** Send OTP for the challenge (cooldown-enforced). */
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
    const channel = this.resolveOtpChannel(ch.identifierType, dto.channel);
    const code = this.generateOtpCode();
    ch.otpCode = code;
    ch.otpExpiresAt = now + OTP_EXPIRY_SEC * 1000;
    ch.lastOtpSentAt = now;
    ch.otpChannel = channel;
    this.persistence.authChallenges.set(dto.challengeId, ch);
    await this.deliverOtp(ch, dto.purpose, code, channel);
    return {
      challengeId: dto.challengeId,
      expiresInSeconds: OTP_EXPIRY_SEC,
      resendAvailableInSeconds: OTP_COOLDOWN_SEC,
      maskedDestination: this.maskIdentifier(ch.identifier, ch.identifierType),
      destinationType: channel,
    };
  }

  /** Resend OTP using the same or an overridden channel. */
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
    const channel = this.resolveOtpChannel(
      ch.identifierType,
      dto.channel ?? ch.otpChannel,
    );
    const code = this.generateOtpCode();
    ch.otpCode = code;
    ch.otpExpiresAt = now + OTP_EXPIRY_SEC * 1000;
    ch.lastOtpSentAt = now;
    ch.otpChannel = channel;
    this.persistence.authChallenges.set(dto.challengeId, ch);
    await this.deliverOtp(ch, purpose, code, channel);
    return {
      challengeId: dto.challengeId,
      expiresInSeconds: OTP_EXPIRY_SEC,
      resendAvailableInSeconds: OTP_COOLDOWN_SEC,
      maskedDestination: this.maskIdentifier(ch.identifier, ch.identifierType),
      destinationType: channel,
    };
  }

  /**
   * Verify OTP for login (tokens), register (create user + tokens), or
   * password-reset (reset session token).
   */
  async verifyOtp(dto: OtpVerifyDto) {
    const ch = this.persistence.authChallenges.get(dto.challengeId);
    if (!ch) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    const code = String(dto.code || '').trim();
    const otpOk =
      !!(
        ch.otpExpiresAt &&
        Date.now() < ch.otpExpiresAt &&
        ch.otpCode === code
      ) || this.isMockOtp(code);
    if (!otpOk) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (dto.purpose === 'reset_password') {
      const lookup =
        ch.identifierType === 'email'
          ? ch.identifier.toLowerCase()
          : ch.identifier;
      const user = await this.findUserByIdentifier(lookup);
      if (!user) {
        throw new UnauthorizedException(
          ch.identifierType === 'mobile'
            ? 'No account found for this mobile number'
            : 'No account found for this email',
        );
      }
      const token = newId();
      this.persistence.resetSessions.set(token, {
        userId: user.id,
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
          : `${ch.identifier.replace(/\D/g, '')}.mobile@blacktiger.local`;
      const displayEmail =
        ch.identifierType === 'email' ? ch.identifier : emailKey;
      if (await this.userExists(emailKey)) {
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
    let user = await this.findUserByIdentifier(lookup);

    // Mock OTP path: mobile WhatsApp OTP with 123456 can complete without a
    // pre-existing partner (creates a storefront user on the fly).
    if (!user && this.isMockOtp(code) && ch.identifierType === 'mobile') {
      const digits = ch.identifier.replace(/\D/g, '') || 'mobile';
      const email = `${digits}@dev.whatsapp.local`;
      this.logger.warn(
        `Mock OTP login: provisioning storefront user for ${ch.identifier}`,
      );
      user = await this.persistNewUser({
        email,
        passwordHash: hashPassword(newId()),
        displayName: ch.identifier,
        phone: ch.identifier,
      });
    }

    if (!user) {
      throw new UnauthorizedException(
        ch.identifierType === 'mobile'
          ? 'No account found for this mobile number'
          : 'No account found for this email',
      );
    }
    const tokens = await this.buildAuthTokens(user);
    return { kind: 'tokens' as const, data: tokens };
  }

  /**
   * Start password reset via OTP challenge or email magic link.
   * Always returns a generic message when the account is missing (no enumeration).
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const id = dto.identifier.trim();
    const type = this.detectType(id);
    const key = type === 'email' ? id.toLowerCase() : id;
    const user = await this.findUserByIdentifier(key);
    const method =
      dto.preferredMethod === 'otp'
        ? ('otp' as const)
        : dto.preferredMethod === 'email_link'
          ? ('email_link' as const)
          : type === 'email'
            ? ('email_link' as const)
            : ('otp' as const);

    if (!user) {
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
      const channel = this.resolveOtpChannel(
        type === 'email' ? 'email' : 'mobile',
      );
      this.persistence.authChallenges.set(challengeId, {
        challengeId,
        identifier: key,
        identifierType: type,
        intent: 'login',
        resetPurpose: true,
        otpCode: code,
        otpExpiresAt: now + OTP_EXPIRY_SEC * 1000,
        lastOtpSentAt: now,
        otpChannel: channel,
      });
      await this.deliverOtp(
        {
          identifier: user.email ?? key,
          identifierType: type === 'email' ? 'email' : 'mobile',
        },
        'reset_password',
        code,
        channel,
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
      userId: user.id,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
    const storefront = (
      this.config.get<string>('STOREFRONT_URL') || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const resetUrl = `${storefront}/reset-password?token=${encodeURIComponent(token)}`;
    if (user.email && this.mail.isConfigured()) {
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
    } else if (this.isDevMode()) {
      this.logger.log(`Dev password reset URL: ${resetUrl}`);
    }
    return {
      message: 'If an account exists, instructions have been sent.',
      deliveryMethod: 'email_link' as const,
      maskedDestination: this.maskIdentifier(id, type),
      challengeId: null,
    };
  }

  /** Validate a password-reset magic-link token without consuming it. */
  async validateResetToken(token: string) {
    const row = this.persistence.resetTokens.get(token);
    if (!row || row.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired token');
    }
    let user = this.persistence.usersById.get(row.userId);
    if (!user && this.isLiveAuth()) {
      const partnerId = parsePartnerAccountId(row.userId);
      if (partnerId) {
        const profile = await this.odooCustomers.getAuthProfile({ partnerId });
        if (profile.ok) {
          user = this.cacheFromProfile(profile);
        }
      }
    }
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

  /**
   * Set a new password via magic-link token, OTP reset session, or inline OTP.
   * Live mode writes the hash to Odoo; optionally auto-logs the user in.
   */
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
        ) || !!(ch && this.isMockOtp(dto.code));
      if (!ch || !otpOk) {
        throw new UnauthorizedException('Invalid token, OTP, or session');
      }
      const lookup =
        ch.identifierType === 'email'
          ? ch.identifier.toLowerCase()
          : ch.identifier;
      const user = await this.findUserByIdentifier(lookup);
      userId = user?.id;
    }

    if (!userId) {
      throw new BadRequestException('Missing reset credentials');
    }

    let user = this.persistence.usersById.get(userId);
    if (!user && this.isLiveAuth()) {
      const partnerId = parsePartnerAccountId(userId);
      if (partnerId) {
        const profile = await this.odooCustomers.getAuthProfile({ partnerId });
        if (profile.ok) {
          user = this.cacheFromProfile(profile);
        }
      }
    }
    if (!user) {
      throw new UnauthorizedException('Invalid token, OTP, or session');
    }

    const passwordHash = hashPassword(dto.password);
    if (this.isLiveAuth()) {
      try {
        const profile = await this.odooCustomers.storefrontSetPassword({
          email: user.email,
          passwordHash,
        });
        if (!profile.ok) {
          throw new ServiceUnavailableException(
            'Unable to update password in Odoo. Please try again.',
          );
        }
        user = this.cacheFromProfile(profile);
      } catch (err) {
        if (err instanceof ServiceUnavailableException) {
          throw err;
        }
        this.logger.error(
          `Odoo set password failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          'Unable to update password in Odoo. Please try again.',
        );
      }
    } else {
      user.passwordHash = passwordHash;
    }

    const autoLogin = dto.autoLogin !== false;
    const tokens = autoLogin ? await this.buildAuthTokens(user) : undefined;
    return {
      message: 'Password updated successfully.',
      tokens,
    };
  }

  /** Rotate refresh token (revoke old jti) and issue a new access+refresh pair. */
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

    let user = this.persistence.usersById.get(decoded.sub);
    if (!user && this.isLiveAuth()) {
      const partnerId = parsePartnerAccountId(decoded.sub);
      if (partnerId) {
        const profile = await this.odooCustomers.getAuthProfile({ partnerId });
        if (profile.ok) {
          user = this.cacheFromProfile(profile);
        }
      }
    }
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.buildAuthTokens(user);
  }

  /** Revoke all refresh tokens for the user (access token expires naturally). */
  logout(userId: string) {
    for (const rec of this.persistence.refreshTokens.values()) {
      if (rec.userId === userId) {
        rec.revoked = true;
      }
    }
  }

  /** Issue access + refresh JWTs and cache the refresh jti for rotation. */
  private async buildAuthTokens(user: StoredUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      segment: user.segment,
      approvalStatus: user.approvalStatus,
      odooPartnerId: user.odooPartnerId,
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
      odooPartnerId: user.odooPartnerId ?? null,
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
