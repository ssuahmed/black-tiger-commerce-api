import { Injectable, Logger } from '@nestjs/common';
import { OdooClient } from './odoo.client';

export type StorefrontAccountProfile = {
  found: boolean;
  partnerId?: number;
  name?: string;
  email?: string;
  phone?: string | false;
  segment?: 'b2c' | 'b2b';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  isCompany?: boolean;
  companyName?: string | null;
  creditLimit?: number;
  currency?: string;
  shippingAddress?: Record<string, string> | null;
  billingAddress?: Record<string, string> | null;
};

type OdooStorefrontAccount = {
  found: boolean;
  partner_id?: number;
  name?: string;
  email?: string;
  phone?: string | false;
  segment?: 'b2c' | 'b2b';
  approval_status?: 'pending' | 'approved' | 'rejected';
  is_company?: boolean;
  company_name?: string | null;
  credit_limit?: number;
  currency?: string;
  shipping_address?: Record<string, string> | null;
  billing_address?: Record<string, string> | null;
};

@Injectable()
export class OdooCustomerService {
  private readonly logger = new Logger(OdooCustomerService.name);

  constructor(private readonly odoo: OdooClient) {}

  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  async getStorefrontAccount(email: string): Promise<StorefrontAccountProfile> {
    const row = await this.odoo.executeKw<OdooStorefrontAccount>(
      'res.partner',
      'bt_get_storefront_account',
      [email],
    );
    if (!row?.found) {
      return { found: false };
    }
    return {
      found: true,
      partnerId: row.partner_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      segment: row.segment,
      approvalStatus: row.approval_status,
      isCompany: row.is_company,
      companyName: row.company_name,
      creditLimit: row.credit_limit,
      currency: row.currency,
      shippingAddress: row.shipping_address,
      billingAddress: row.billing_address,
    };
  }

  async syncStorefrontProfile(payload: Record<string, unknown>): Promise<void> {
    await this.odoo.executeKw('res.partner', 'bt_sync_storefront_profile', [payload]);
  }

  /**
   * Persist a storefront signup as ``res.partner`` (find-or-create by email).
   * No-op when Odoo is not in live mode. Returns the partner id when created/updated.
   */
  async ensureStorefrontSignup(input: {
    email: string;
    name?: string;
    phone?: string;
    segment?: 'b2c' | 'b2b';
    approvalStatus?: 'pending' | 'approved' | 'rejected';
  }): Promise<number | null> {
    if (!this.isLive()) {
      return null;
    }
    const email = input.email.trim();
    if (!email) {
      return null;
    }
    const segment = input.segment ?? 'b2c';
    const approvalStatus =
      input.approvalStatus ??
      (segment === 'b2b' ? 'pending' : 'approved');
    const result = await this.odoo.executeKw<{
      updated?: boolean;
      partner_id?: number;
      reason?: string;
    }>('res.partner', 'bt_sync_storefront_profile', [
      {
        email,
        name: input.name || email.split('@')[0] || email,
        phone: input.phone,
        segment,
        approval_status: approvalStatus,
      },
    ]);
    const partnerId = result?.partner_id;
    if (!partnerId) {
      this.logger.warn(
        `Odoo signup sync returned no partner_id for ${email}: ${JSON.stringify(result)}`,
      );
      return null;
    }
    this.logger.log(`Odoo signup synced ${email} → partner ${partnerId}`);
    return partnerId;
  }
}
