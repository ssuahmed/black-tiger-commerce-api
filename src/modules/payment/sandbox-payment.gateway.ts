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

  async createIntent(
    cartId: string,
    userId: string,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    const paymentIntentId = newId();
    const clientSecret = `sandbox_secret_${paymentIntentId}`;
    const status: PaymentIntentStatus =
      input.method === 'card' ? 'requires_confirmation' : 'succeeded';
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

  async confirmIntent(paymentIntentId: string) {
    const row = this.persistence.paymentIntentsById.get(paymentIntentId);
    if (!row) {
      throw new NotFoundException('Payment intent not found');
    }
    row.status = 'succeeded';
    row.updatedAt = new Date().toISOString();
    return { status: 'succeeded' as const };
  }

  getIntentStatus(paymentIntentId: string): PaymentIntentStatus | undefined {
    return this.persistence.paymentIntentsById.get(paymentIntentId)?.status;
  }
}
