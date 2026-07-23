import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    if (this.isConfigured()) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: Number(this.config.get<string>('SMTP_PORT') || 587),
        secure: false,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SMTP_HOST') &&
        this.config.get<string>('SMTP_USER') &&
        this.config.get<string>('SMTP_PASS'),
    );
  }

  private fromAddress(): string {
    return (
      this.config.get<string>('SMTP_FROM') ||
      'Black Tiger <noreply@blacktiger.com.sa>'
    );
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — skipping email to ${message.to}: ${message.subject}`,
      );
      return;
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? message.text.replace(/\n/g, '<br/>'),
      });
      this.logger.log(
        `Email sent to ${message.to} subject="${message.subject}" id=${info.messageId}`,
      );
    } catch (err) {
      this.logger.error(
        `Email failed to ${message.to}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async sendOtpEmail(input: {
    to: string;
    code: string;
    purpose: 'login' | 'register' | 'reset_password';
    expiresInSeconds: number;
  }): Promise<void> {
    const purposeLabel =
      input.purpose === 'login'
        ? 'sign-in'
        : input.purpose === 'register'
          ? 'registration'
          : 'password reset';
    const minutes = Math.max(1, Math.round(input.expiresInSeconds / 60));
    const subject = `Your Black Tiger ${purposeLabel} code`;
    const text = [
      `Your Black Tiger verification code is: ${input.code}`,
      '',
      `This code expires in ${minutes} minute(s).`,
      'If you did not request this, you can ignore this email.',
    ].join('\n');
    const html = `
      <p>Your Black Tiger verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${input.code}</p>
      <p>This code expires in ${minutes} minute(s).</p>
      <p style="color:#666;">If you did not request this, you can ignore this email.</p>
    `;
    await this.send({ to: input.to, subject, text, html });
  }

  async sendPasswordResetLink(input: {
    to: string;
    resetUrl: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const minutes = Math.max(1, Math.round(input.expiresInSeconds / 60));
    const subject = 'Reset your Black Tiger password';
    const text = [
      'Reset your Black Tiger password using this link:',
      input.resetUrl,
      '',
      `This link expires in ${minutes} minute(s).`,
      'If you did not request a reset, you can ignore this email.',
    ].join('\n');
    const html = `
      <p>Reset your Black Tiger password:</p>
      <p><a href="${input.resetUrl}">${input.resetUrl}</a></p>
      <p>This link expires in ${minutes} minute(s).</p>
      <p style="color:#666;">If you did not request a reset, you can ignore this email.</p>
    `;
    await this.send({ to: input.to, subject, text, html });
  }
}
