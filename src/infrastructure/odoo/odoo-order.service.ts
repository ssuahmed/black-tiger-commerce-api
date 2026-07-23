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
