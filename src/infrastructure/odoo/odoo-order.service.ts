import { Injectable, Logger } from '@nestjs/common';
import { OdooClient } from './odoo.client';

export interface StorefrontOrderLineInput {
  product_slug: string;
  packaging_option_id: string;
  quantity: number;
  pallet_type: 'unit' | 'partial' | 'full';
  price_unit: number;
}

export interface StorefrontAddressInput {
  name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  postal_code?: string;
  country_code?: string;
}

export interface StorefrontCheckoutPayload {
  cart_id: string;
  customer: {
    name: string;
    email: string;
    phone?: string;
  };
  shipping_address: StorefrontAddressInput;
  billing_address: StorefrontAddressInput;
  lines: StorefrontOrderLineInput[];
  shipping_amount: number;
  shipping_label: string;
  shipping_option_id: string;
  note?: string;
  payment?: {
    provider: string;
    method?: string;
    status: string;
    tran_ref?: string;
    amount?: number;
    currency?: string;
  };
}

export interface OdooSaleOrderResult {
  order_id: number;
  order_number: string;
  state: string;
  amount_total: number;
  currency: string;
  formatted_total: string;
  partner_id: number;
  line_count: number;
  paytabs_tran_ref?: string | false;
  payment_status?: string | false;
  payment?: {
    recorded?: boolean;
    payment_id?: number | false;
    invoice_id?: number;
    tran_ref?: string | false;
    reason?: string;
    idempotent?: boolean;
    order_state?: string;
    amount?: number;
  };
}

export interface OdooOrdersPage {
  items: Array<{
    id: number;
    orderNumber: string;
    status: string;
    createdAt: string | false;
    itemCount: number;
    total: number;
    currency: string;
    formattedTotal: string;
    shippingLabel: string | null;
    paymentMethod?: string | null;
    paymentProvider?: string | null;
    paymentStatus?: string | null;
    paytabsTranRef?: string | null;
    wireTransferAmount?: number | null;
    wireTransferDate?: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class OdooOrderService {
  private readonly logger = new Logger(OdooOrderService.name);

  constructor(private readonly odoo: OdooClient) {}

  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  /**
   * Create/refresh a draft Odoo quotation, or confirm + record payment when
   * `payment.status` is succeeded for card/apple_pay (idempotent on cart_id).
   */
  async createStorefrontOrder(
    payload: StorefrontCheckoutPayload,
  ): Promise<OdooSaleOrderResult> {
    const result = await this.odoo.executeKw<OdooSaleOrderResult>(
      'sale.order',
      'bt_create_storefront_order',
      [payload],
    );
    if (!result?.order_id) {
      throw new Error('Odoo did not return a sale order id');
    }
    return result;
  }

  async attachWireReceipt(input: {
    orderId?: number | string;
    orderNumber?: string;
    partnerEmail: string;
    amount?: number;
    transferDate?: string;
    fileName: string;
    mimeType: string;
    dataBase64: string;
  }): Promise<{
    ok: boolean;
    attachmentId?: number;
    orderId?: number;
    orderNumber?: string;
    paymentStatus?: string;
    reason?: string;
  }> {
    const row = await this.odoo.executeKw<{
      ok?: boolean;
      attachment_id?: number;
      order_id?: number;
      order_number?: string;
      payment_status?: string | false;
      reason?: string;
    }>('sale.order', 'bt_attach_wire_receipt', [
      {
        order_id: input.orderId ? Number(input.orderId) : undefined,
        order_number: input.orderNumber,
        partner_email: input.partnerEmail,
        amount: input.amount,
        transfer_date: input.transferDate,
        file_name: input.fileName,
        mimetype: input.mimeType,
        datas: input.dataBase64,
      },
    ]);
    return {
      ok: Boolean(row?.ok),
      attachmentId: row?.attachment_id ? Number(row.attachment_id) : undefined,
      orderId: row?.order_id ? Number(row.order_id) : undefined,
      orderNumber: row?.order_number ? String(row.order_number) : undefined,
      paymentStatus: row?.payment_status ? String(row.payment_status) : undefined,
      reason: row?.reason,
    };
  }

  async listStorefrontOrders(
    partnerEmail: string,
    page = 1,
    pageSize = 20,
  ): Promise<OdooOrdersPage> {
    return this.odoo.executeKw<OdooOrdersPage>(
      'sale.order',
      'bt_search_storefront_orders',
      [partnerEmail, page, pageSize],
    );
  }
}
