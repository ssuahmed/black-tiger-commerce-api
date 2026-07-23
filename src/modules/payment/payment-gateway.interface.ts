export type PaymentMethod = 'card' | 'cod' | 'wire';

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'succeeded'
  | 'failed';

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: PaymentIntentStatus;
  gateway: string;
  redirectUrl?: string | null;
  tranRef?: string | null;
  amount?: number;
  currency?: string;
}

export interface CreatePaymentIntentInput {
  method: PaymentMethod;
  amount?: number;
  currency?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
  cartDescription?: string;
}

export interface PaymentGatewayAdapter {
  createIntent(
    cartId: string,
    userId: string,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult>;
  confirmIntent(
    paymentIntentId: string,
  ): Promise<{ status: 'succeeded' | 'failed' }>;
  getIntentStatus(paymentIntentId: string): PaymentIntentStatus | undefined;
}
