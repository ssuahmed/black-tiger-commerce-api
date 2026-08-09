import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type WhatsAppOtpSendInput = {
  /** E.164 without spaces, e.g. 9665xxxxxxxx */
  to: string;
  code: string;
  purpose: 'login' | 'register' | 'reset_password';
};

@Injectable()
export class WhatsAppCloudService {
  private readonly logger = new Logger(WhatsAppCloudService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    if (this.config.get<string>('WHATSAPP_CLOUD_ENABLED') === 'false') {
      return false;
    }
    return Boolean(
      this.config.get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID')?.trim() &&
        this.config.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN')?.trim() &&
        this.config.get<string>('WHATSAPP_CLOUD_OTP_TEMPLATE_NAME')?.trim(),
    );
  }

  private apiVersion(): string {
    return (
      this.config.get<string>('WHATSAPP_CLOUD_API_VERSION')?.trim() || 'v21.0'
    );
  }

  private normalizeMsisdn(to: string): string {
    return String(to || '').replace(/\D/g, '');
  }

  /**
   * Sends an authentication-template OTP via Meta WhatsApp Cloud API.
   * When credentials are missing, logs only (dev-friendly stub).
   */
  async sendOtp(input: WhatsAppOtpSendInput): Promise<void> {
    const to = this.normalizeMsisdn(input.to);
    if (!to) {
      throw new Error('WhatsApp OTP destination is empty');
    }

    if (!this.isConfigured()) {
      this.logger.warn(
        `WhatsApp Cloud API not configured — OTP for +${to} not sent (${input.purpose})`,
      );
      if (
        this.config.get<string>('NODE_ENV') === 'development' ||
        process.env.NODE_ENV === 'development'
      ) {
        this.logger.log(`Dev OTP (whatsapp): ${input.code}`);
      }
      return;
    }

    const phoneNumberId = this.config
      .get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID')!
      .trim();
    const token = this.config.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN')!.trim();
    const templateName = this.config
      .get<string>('WHATSAPP_CLOUD_OTP_TEMPLATE_NAME')!
      .trim();
    const language =
      this.config.get<string>('WHATSAPP_CLOUD_OTP_TEMPLATE_LANGUAGE')?.trim() ||
      'en';

    const url = `https://graph.facebook.com/${this.apiVersion()}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: input.code }],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: input.code }],
          },
        ],
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      this.logger.error(
        `WhatsApp Cloud API error ${res.status} for +${to}: ${text.slice(0, 500)}`,
      );
      throw new Error(`WhatsApp Cloud API failed (${res.status})`);
    }

    this.logger.log(`WhatsApp OTP sent to +${to} (${input.purpose})`);
  }
}
