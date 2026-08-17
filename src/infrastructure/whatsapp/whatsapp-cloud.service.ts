/**
 * Meta WhatsApp Cloud API client for storefront OTP delivery.
 *
 * Used by auth when the identifier is a mobile number (default channel).
 * When credentials are missing or disabled, logs only (and prints the code
 * if `USE_MOCK_OTP` is on) so local/dev flows still work.
 * `WHATSAPP_SEND_HELLO_FOR_TEST` sends Meta's parameter-less `hello_world`
 * template and still uses mock OTP `123456` even when `USE_MOCK_OTP` is off.
 */
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

  constructor(private readonly config: ConfigService) {
    this.logger.log(
      `WHATSAPP_SEND_HELLO_FOR_TEST=${this.sendHelloForTest() ? 'true' : 'false'}`,
    );
  }

  /** True when WhatsApp Cloud env vars are present and not explicitly disabled. */
  isConfigured(): boolean {
    if (this.config.get<string>('WHATSAPP_CLOUD_ENABLED') === 'false') {
      return false;
    }
    return Boolean(
      this.config.get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID')?.trim() &&
        this.config.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN')?.trim() &&
        (this.sendHelloForTest() ||
          this.config.get<string>('WHATSAPP_CLOUD_OTP_TEMPLATE_NAME')?.trim()),
    );
  }

  /**
   * Dev probe: send `hello_world` (no body/params) and keep OTP as 123456
   * even when `USE_MOCK_OTP` is false.
   */
  sendHelloForTest(): boolean {
    return this.envFlag('WHATSAPP_SEND_HELLO_FOR_TEST');
  }

  private apiVersion(): string {
    return (
      this.config.get<string>('WHATSAPP_CLOUD_API_VERSION')?.trim() || 'v21.0'
    );
  }

  private useMockOtp(): boolean {
    return this.envFlag('USE_MOCK_OTP');
  }

  private envFlag(key: string): boolean {
    const raw = (this.config.get<string>(key) ?? process.env[key] ?? '')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
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
      if (this.useMockOtp()) {
        this.logger.log(`Mock OTP (whatsapp): ${input.code}`);
      }
      return;
    }

    const phoneNumberId = this.config
      .get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID')!
      .trim();
    const token = this.config.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN')!.trim();
    const helloTest = this.sendHelloForTest();
    const templateName = helloTest
      ? 'hello_world'
      : this.config.get<string>('WHATSAPP_CLOUD_OTP_TEMPLATE_NAME')!.trim();
    const language = helloTest
      ? 'en_US'
      : this.config.get<string>('WHATSAPP_CLOUD_OTP_TEMPLATE_LANGUAGE')?.trim() ||
        'en';

    const url = `https://graph.facebook.com/${this.apiVersion()}/${phoneNumberId}/messages`;
    const template: {
      name: string;
      language: { code: string };
      components?: Array<Record<string, unknown>>;
    } = {
      name: templateName,
      language: { code: language },
    };
    if (!helloTest) {
      template.components = [
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
      ];
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template,
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

    this.logger.log(
      helloTest
        ? `WhatsApp hello_world test sent to +${to} (${input.purpose})`
        : `WhatsApp OTP sent to +${to} (${input.purpose})`,
    );
  }
}
