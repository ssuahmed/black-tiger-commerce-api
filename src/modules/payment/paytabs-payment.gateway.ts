/**
 * PayTabs hosted payment-page gateway for card and Apple Pay.
 *
 * Creates a PayTabs payment request, stores intent + `tran_ref` mapping,
 * confirms via `/payment/query`, and applies signed server callbacks to the
 * checkout draft. Requires PAYTABS_PROFILE_ID / SERVER_KEY and return/callback URLs.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { newId } from '../../common/utils/uuid';
import { PersistenceService } from '../../persistence/persistence.service';
import type {
  CreatePaymentIntentInput,
  PaymentGatewayAdapter,
  PaymentIntentResult,
  PaymentIntentStatus,
} from './payment-gateway.interface';
import { verifyPayTabsSignature } from './paytabs.signature';
import {
  isPayTabsApproved,
  type PayTabsCallbackPayload,
  type PayTabsPaymentRequest,
  type PayTabsPaymentResponse,
} from './paytabs.types';

@Injectable()
export class PayTabsPaymentGateway implements PaymentGatewayAdapter {
  private readonly logger = new Logger(PayTabsPaymentGateway.name);

  constructor(
    private readonly config: ConfigService,
    private readonly persistence: PersistenceService,
  ) {}

  private profileId(): number {
    const raw = this.config.get<string>('PAYTABS_PROFILE_ID');
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ServiceUnavailableException('PAYTABS_PROFILE_ID is not configured');
    }
    return id;
  }

  private serverKey(): string {
    const key = this.config.get<string>('PAYTABS_SERVER_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException('PAYTABS_SERVER_KEY is not configured');
    }
    return key;
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('PAYTABS_BASE_URL')?.replace(/\/$/, '') ||
      'https://secure.paytabs.sa'
    );
  }

  private returnUrl(): string {
    return (
      this.config.get<string>('PAYTABS_RETURN_URL')?.trim() ||
      'http://localhost:3000/cart/payment/return'
    );
  }

  private callbackUrl(): string {
    return (
      this.config.get<string>('PAYTABS_CALLBACK_URL')?.trim() ||
      'http://localhost:3001/internal/webhooks/paytabs'
    );
  }

  /**
   * Request a PayTabs hosted page; persist redirect URL + tran_ref for the cart.
   */
  async createIntent(
    cartId: string,
    userId: string,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    if (input.method !== 'card' && input.method !== 'apple_pay') {
      throw new BadRequestException(
        'PayTabs gateway only handles card and Apple Pay payments',
      );
    }

    const amount = Number(input.amount ?? 0);
    if (!(amount > 0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    const currency = (input.currency || this.config.get<string>('PAYTABS_CURRENCY') || 'SAR')
      .toUpperCase();

    const paymentIntentId = newId();
    const cartRef = `${cartId}:${paymentIntentId}`.slice(0, 64);
    const body: PayTabsPaymentRequest = {
      profile_id: this.profileId(),
      tran_type: 'sale',
      tran_class: 'ecom',
      cart_id: cartRef,
      cart_currency: currency,
      cart_amount: Math.round(amount * 100) / 100,
      cart_description: input.cartDescription || `Black Tiger cart ${cartId}`,
      paypage_lang: 'en',
      customer_details: {
        name: input.customerName || 'Customer',
        email: input.customerEmail || 'customer@example.com',
        phone: input.customerPhone || '+966500000000',
        country: 'SA',
      },
      return: this.returnUrl(),
      callback: this.callbackUrl(),
    };
    if (input.method === 'apple_pay') {
      body.payment_methods = ['applepay'];
    } else {
      body.payment_methods = ['creditcard'];
    }

    let paytabs: PayTabsPaymentResponse;
    try {
      paytabs = await this.postJson<PayTabsPaymentResponse>('/payment/request', body);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`PayTabs payment/request failed: ${detail}`);
      throw new ServiceUnavailableException(
        detail.startsWith('PayTabs') || detail.includes('Callback') || detail.includes('Invalid')
          ? `PayTabs payment request failed: ${detail}`
          : 'PayTabs payment request failed',
      );
    }

    if (!paytabs.redirect_url || !paytabs.tran_ref) {
      this.logger.error(`PayTabs missing redirect/tran_ref: ${JSON.stringify(paytabs)}`);
      throw new ServiceUnavailableException(
        paytabs.message || 'PayTabs did not return a redirect URL',
      );
    }

    const now = new Date().toISOString();
    const clientSecret = `paytabs_${paytabs.tran_ref}`;
    this.persistence.paymentIntentsById.set(paymentIntentId, {
      paymentIntentId,
      cartId,
      userId,
      method: input.method,
      amount,
      currency,
      status: 'requires_payment_method',
      clientSecret,
      redirectUrl: paytabs.redirect_url,
      tranRef: paytabs.tran_ref,
      gateway: 'paytabs',
      createdAt: now,
      updatedAt: now,
    });
    this.persistence.paymentIntentsByTranRef.set(paytabs.tran_ref, paymentIntentId);

    return {
      paymentIntentId,
      clientSecret,
      status: 'requires_payment_method',
      gateway: 'paytabs',
      redirectUrl: paytabs.redirect_url,
      tranRef: paytabs.tran_ref,
      amount,
      currency,
    };
  }

  /** Poll PayTabs `/payment/query` and sync intent + checkout draft status. */
  async confirmIntent(paymentIntentId: string) {
    const row = this.persistence.paymentIntentsById.get(paymentIntentId);
    if (!row) {
      throw new BadRequestException('Payment intent not found');
    }
    if (row.status === 'succeeded' || row.status === 'failed') {
      return { status: row.status === 'succeeded' ? ('succeeded' as const) : ('failed' as const) };
    }
    if (!row.tranRef) {
      return { status: 'failed' as const };
    }

    try {
      const queried = await this.postJson<PayTabsPaymentResponse>('/payment/query', {
        profile_id: this.profileId(),
        tran_ref: row.tranRef,
      });
      const responseStatus = queried.payment_result?.response_status;
      if (isPayTabsApproved(responseStatus)) {
        row.status = 'succeeded';
        row.updatedAt = new Date().toISOString();
        this.syncDraftStatus(row.cartId, paymentIntentId, row.status);
        return { status: 'succeeded' as const };
      }
      const declined = ['D', 'E', 'C'].includes(String(responseStatus ?? '').toUpperCase());
      if (declined) {
        row.status = 'failed';
        row.updatedAt = new Date().toISOString();
        this.syncDraftStatus(row.cartId, paymentIntentId, row.status);
        return { status: 'failed' as const };
      }
      return { status: 'failed' as const };
    } catch (err) {
      this.logger.warn(
        `PayTabs query failed for ${row.tranRef}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { status: 'failed' as const };
    }
  }

  /** Stored intent status without hitting PayTabs. */
  getIntentStatus(paymentIntentId: string): PaymentIntentStatus | undefined {
    return this.persistence.paymentIntentsById.get(paymentIntentId)?.status;
  }

  /**
   * Verify HMAC signature, map `tran_ref` → intent, mark succeeded/failed,
   * and mirror status onto the checkout draft.
   */
  handleCallback(rawBody: Buffer, signatureHeader: string | undefined) {
    if (!verifyPayTabsSignature(rawBody, signatureHeader, this.serverKey())) {
      throw new UnauthorizedException('Invalid PayTabs signature');
    }

    let payload: PayTabsCallbackPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as PayTabsCallbackPayload;
    } catch {
      throw new BadRequestException('Invalid PayTabs callback body');
    }

    const tranRef = payload.tran_ref;
    if (!tranRef) {
      throw new BadRequestException('PayTabs callback missing tran_ref');
    }

    const paymentIntentId = this.persistence.paymentIntentsByTranRef.get(tranRef);
    const row = paymentIntentId
      ? this.persistence.paymentIntentsById.get(paymentIntentId)
      : undefined;
    if (!row) {
      this.logger.warn(`PayTabs callback for unknown tran_ref=${tranRef}`);
      return { ok: true, matched: false, tranRef };
    }

    const approved = isPayTabsApproved(payload.payment_result?.response_status);
    row.status = approved ? 'succeeded' : 'failed';
    row.updatedAt = new Date().toISOString();
    this.syncDraftStatus(row.cartId, row.paymentIntentId, row.status);

    this.logger.log(
      `PayTabs callback ${tranRef} → ${row.status} (cart ${row.cartId})`,
    );
    return {
      ok: true,
      matched: true,
      tranRef,
      paymentIntentId: row.paymentIntentId,
      status: row.status,
      cartId: row.cartId,
    };
  }

  private syncDraftStatus(
    cartId: string,
    paymentIntentId: string,
    status: PaymentIntentStatus,
  ) {
    const draft = this.persistence.checkoutDrafts.get(cartId);
    if (!draft) return;
    const stored = draft.payload['paymentIntent'] as
      | { paymentIntentId?: string }
      | undefined;
    if (stored?.paymentIntentId !== paymentIntentId) return;
    draft.payload['paymentIntent'] = { ...stored, status };
    this.persistence.checkoutDrafts.set(cartId, draft);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.serverKey(),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: T & { message?: string };
    try {
      json = text ? (JSON.parse(text) as T & { message?: string }) : ({} as T & { message?: string });
    } catch {
      throw new Error(`PayTabs non-JSON response HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(json.message || `PayTabs HTTP ${res.status}`);
    }
    return json;
  }
}
