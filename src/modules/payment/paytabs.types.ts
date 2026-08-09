export interface PayTabsPaymentRequest {
  profile_id: number;
  tran_type: 'sale' | 'auth';
  tran_class: 'ecom';
  cart_id: string;
  cart_currency: string;
  cart_amount: number;
  cart_description: string;
  paypage_lang?: string;
  /** Restrict HPP methods, e.g. ['applepay'] or ['creditcard']. */
  payment_methods?: string[];
  customer_details?: {
    name?: string;
    email?: string;
    phone?: string;
    street1?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
  };
  return: string;
  callback: string;
}

export interface PayTabsPaymentResponse {
  tran_ref?: string;
  cart_id?: string;
  cart_amount?: string | number;
  cart_currency?: string;
  redirect_url?: string;
  payment_result?: {
    response_status?: string;
    response_code?: string;
    response_message?: string;
  };
  code?: string | number;
  message?: string;
}

export interface PayTabsCallbackPayload {
  tran_ref?: string;
  cart_id?: string;
  cart_amount?: string | number;
  cart_currency?: string;
  payment_result?: {
    response_status?: string;
    response_code?: string;
    response_message?: string;
  };
  [key: string]: unknown;
}

export function isPayTabsApproved(status?: string): boolean {
  return String(status ?? '').toUpperCase() === 'A';
}
