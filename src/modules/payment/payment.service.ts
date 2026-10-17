/**
 * Payment facade for checkout: routes card/Apple Pay to PayTabs when
 * `PAYMENT_GATEWAY=paytabs`, otherwise sandbox. COD/wire always use the
 * sandbox adapter (auto-succeed intents). Intents are stored in
 * {@link PersistenceService}.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreatePaymentIntentInput,
  PaymentGatewayAdapter,
  PaymentIntentResult,
  PaymentMethod,
} from './payment-gateway.interface';
import { PayTabsPaymentGateway } from './paytabs-payment.gateway';
import { SandboxPaymentGateway } from './sandbox-payment.gateway';
import { PersistenceService } from '../../persistence/persistence.service';

@Injectable()
export class PaymentService {
  private readonly gatewayName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly sandbox: SandboxPaymentGateway,
    private readonly paytabs: PayTabsPaymentGateway,
    private readonly persistence: PersistenceService,
  ) {
    this.gatewayName = (
      this.config.get<string>('PAYMENT_GATEWAY') ?? 'sandbox'
    ).toLowerCase();
  }

  /** Card / Apple Pay use PayTabs when configured; COD/wire always use sandbox auto-succeed. */
  private adapterFor(method: PaymentMethod): PaymentGatewayAdapter {
    if (
      (method === 'card' || method === 'apple_pay') &&
      this.gatewayName === 'paytabs'
    ) {
      return this.paytabs;
    }
    return this.sandbox;
  }

  /** Create a gateway payment intent for the cart. */
  createIntent(
    cartId: string,
    userId: string,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    return this.adapterFor(input.method).createIntent(cartId, userId, input);
  }

  /** Confirm an intent (sandbox) or query PayTabs for final status. */
  confirmIntent(paymentIntentId: string) {
    const row = this.persistence.paymentIntentsById.get(paymentIntentId);
    const method = row?.method ?? 'card';
    return this.adapterFor(method).confirmIntent(paymentIntentId);
  }

  /** Current intent status from persistence (fallback sandbox lookup). */
  getIntentStatus(paymentIntentId: string) {
    const stored = this.persistence.paymentIntentsById.get(paymentIntentId);
    if (stored?.status) return stored.status;
    return this.sandbox.getIntentStatus(paymentIntentId);
  }

  /** Raw payment-intent entity, if known. */
  getIntent(paymentIntentId: string) {
    return this.persistence.paymentIntentsById.get(paymentIntentId);
  }

  /** Verify and apply a signed PayTabs server callback. */
  handlePayTabsCallback(rawBody: Buffer, signatureHeader: string | undefined) {
    return this.paytabs.handleCallback(rawBody, signatureHeader);
  }

  /** Active gateway name for checkout notes / Odoo payment payload. */
  activeGateway() {
    if (this.gatewayName === 'paytabs') return 'paytabs';
    if (this.gatewayName === 'placeholder') return 'placeholder';
    return 'sandbox';
  }
}
