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

  /** Card uses PayTabs when configured; COD/wire always use sandbox auto-succeed. */
  private adapterFor(method: PaymentMethod): PaymentGatewayAdapter {
    if (method === 'card' && this.gatewayName === 'paytabs') {
      return this.paytabs;
    }
    return this.sandbox;
  }

  createIntent(
    cartId: string,
    userId: string,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    return this.adapterFor(input.method).createIntent(cartId, userId, input);
  }

  confirmIntent(paymentIntentId: string) {
    const row = this.persistence.paymentIntentsById.get(paymentIntentId);
    const method = row?.method ?? 'card';
    return this.adapterFor(method).confirmIntent(paymentIntentId);
  }

  getIntentStatus(paymentIntentId: string) {
    const stored = this.persistence.paymentIntentsById.get(paymentIntentId);
    if (stored?.status) return stored.status;
    return this.sandbox.getIntentStatus(paymentIntentId);
  }

  getIntent(paymentIntentId: string) {
    return this.persistence.paymentIntentsById.get(paymentIntentId);
  }

  handlePayTabsCallback(rawBody: Buffer, signatureHeader: string | undefined) {
    return this.paytabs.handleCallback(rawBody, signatureHeader);
  }

  activeGateway() {
    if (this.gatewayName === 'paytabs') return 'paytabs';
    if (this.gatewayName === 'placeholder') return 'placeholder';
    return 'sandbox';
  }
}
