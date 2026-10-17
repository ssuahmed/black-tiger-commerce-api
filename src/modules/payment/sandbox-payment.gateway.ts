/**
 * Local/dev payment gateway: no external network.
 *
 * Card/Apple Pay intents start as `requires_confirmation` and succeed on
 * confirm; COD/wire intents succeed immediately. Used when PayTabs is off
 * and for non-card methods even when PayTabs is the active card gateway.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import { PersistenceService } from '../../persistence/persistence.service';
import type {
  CreatePaymentIntentInput,
  PaymentGatewayAdapter,
  PaymentIntentResult,
  PaymentIntentStatus,
} from './payment-gateway.interface';

@Injectable()
export class SandboxPaymentGateway implements PaymentGatewayAdapter {
  constructor(private readonly persistence: PersistenceService) {}

  /** Create an in-memory intent (no redirect / tran_ref). */
  async createIntent(
    cartId: string,
    userId: string,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    const paymentIntentId = newId();
    const clientSecret = `sandbox_secret_${paymentIntentId}`;
    const status: PaymentIntentStatus =
      input.method === 'card' || input.method === 'apple_pay'
        ? 'requires_confirmation'
        : 'succeeded';
    const now = new Date().toISOString();
    const amount = Number(input.amount ?? 0);
    const currency = input.currency ?? 'SAR';

    this.persistence.paymentIntentsById.set(paymentIntentId, {
      paymentIntentId,
      cartId,
      userId,
      method: input.method,
      amount,
      currency,
      status,
      clientSecret,
      redirectUrl: null,
      tranRef: null,
      gateway: 'sandbox',
      createdAt: now,
      updatedAt: now,
    });

    return {
      paymentIntentId,
      clientSecret,
      status,
      gateway: 'sandbox',
      redirectUrl: null,
      tranRef: null,
      amount,
      currency,
    };
  }

  /** Mark sandbox intent succeeded (storefront confirm button / e2e). */
  async confirmIntent(paymentIntentId: string) {
    const row = this.persistence.paymentIntentsById.get(paymentIntentId);
    if (!row) {
      throw new NotFoundException('Payment intent not found');
    }
    row.status = 'succeeded';
    row.updatedAt = new Date().toISOString();
    return { status: 'succeeded' as const };
  }

  /** Current sandbox intent status. */
  getIntentStatus(paymentIntentId: string): PaymentIntentStatus | undefined {
    return this.persistence.paymentIntentsById.get(paymentIntentId)?.status;
  }
}
