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
  infoVerification?: 'pending' | 'verified' | 'rejected' | null;
  isCompany?: boolean;
  companyName?: string | null;
  creditLimit?: number;
  currency?: string;
  hasCreditAccount?: boolean;
  creditAccountApproved?: boolean;
  creditLimitApproved?: number;
  creditAccountInfo?: Record<string, unknown> | null;
  storefrontEnabled?: boolean;
  shippingAddress?: Record<string, string> | null;
  billingAddress?: Record<string, string> | null;
};

export type StorefrontAuthProfile = {
  ok: boolean;
  found?: boolean;
  reason?: string;
  partnerId?: number;
  email?: string;
  name?: string;
  phone?: string | false;
  segment?: 'b2c' | 'b2b';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  storefrontEnabled?: boolean;
};

type OdooStorefrontAccount = {
  found: boolean;
  partner_id?: number;
  name?: string;
  email?: string;
  phone?: string | false;
  segment?: 'b2c' | 'b2b';
  approval_status?: 'pending' | 'approved' | 'rejected';
  info_verification?: 'pending' | 'verified' | 'rejected' | null;
  is_company?: boolean;
  company_name?: string | null;
  credit_limit?: number;
  currency?: string;
  has_credit_account?: boolean;
  credit_account_approved?: boolean;
  credit_limit_approved?: number;
  credit_account_info?: Record<string, unknown> | null;
  storefront_enabled?: boolean;
  shipping_address?: Record<string, string> | null;
  billing_address?: Record<string, string> | null;
};

type OdooAuthProfile = {
  ok?: boolean;
  found?: boolean;
  reason?: string;
  partner_id?: number;
  email?: string;
  name?: string;
  phone?: string | false;
  segment?: 'b2c' | 'b2b';
  approval_status?: 'pending' | 'approved' | 'rejected';
  storefront_enabled?: boolean;
};

@Injectable()
export class OdooCustomerService {
  private readonly logger = new Logger(OdooCustomerService.name);

  constructor(private readonly odoo: OdooClient) {}

  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  private mapAuthProfile(row: OdooAuthProfile | null | undefined): StorefrontAuthProfile {
    if (!row) {
      return { ok: false, reason: 'empty_response' };
    }
    return {
      ok: Boolean(row.ok),
      found: row.found,
      reason: row.reason,
      partnerId: row.partner_id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      segment: row.segment,
      approvalStatus: row.approval_status,
      storefrontEnabled: row.storefront_enabled,
    };
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
      infoVerification: row.info_verification ?? null,
      isCompany: row.is_company,
      companyName: row.company_name,
      creditLimit: row.credit_limit,
      currency: row.currency,
      hasCreditAccount: Boolean(row.has_credit_account),
      creditAccountApproved: Boolean(row.credit_account_approved),
      creditLimitApproved: Number(row.credit_limit_approved ?? 0) || 0,
      creditAccountInfo:
        row.credit_account_info && typeof row.credit_account_info === 'object'
          ? row.credit_account_info
          : null,
      storefrontEnabled: row.storefront_enabled,
      shippingAddress: row.shipping_address,
      billingAddress: row.billing_address,
    };
  }

  async listStorefrontAddresses(email: string): Promise<
    Array<{
      id: string;
      label: string;
      usageTypes: Array<'shipping' | 'billing'>;
      companyName?: string;
      recipientName?: string;
      countryCode: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      postalCode?: string;
      phone?: string;
      formattedAddress?: string;
      isDefaultShipping: boolean;
      isDefaultBilling: boolean;
    }>
  > {
    if (!this.isLive()) {
      return [];
    }
    const row = await this.odoo.executeKw<{
      items?: Array<Record<string, unknown>>;
    }>('res.partner', 'bt_list_storefront_addresses', [email]);
    const items = Array.isArray(row?.items) ? row.items : [];
    return items.map((item) => {
      const usageRaw = Array.isArray(item.usage_types) ? item.usage_types : [];
      const usageTypes = usageRaw
        .map((u) => String(u))
        .filter((u): u is 'shipping' | 'billing' => u === 'shipping' || u === 'billing');
      return {
        id: `odoo:${Number(item.id)}`,
        label: String(item.label || 'Address'),
        usageTypes: usageTypes.length ? usageTypes : (['shipping'] as Array<'shipping' | 'billing'>),
        companyName: item.company_name ? String(item.company_name) : undefined,
        recipientName: item.recipient_name ? String(item.recipient_name) : undefined,
        countryCode: String(item.country_code || 'SA'),
        addressLine1: String(item.address_line1 || ''),
        addressLine2: item.address_line2 ? String(item.address_line2) : undefined,
        city: String(item.city || ''),
        postalCode: item.postal_code ? String(item.postal_code) : undefined,
        phone: item.phone ? String(item.phone) : undefined,
        formattedAddress: item.formatted_address
          ? String(item.formatted_address)
          : undefined,
        isDefaultShipping: Boolean(item.is_default_shipping),
        isDefaultBilling: Boolean(item.is_default_billing),
      };
    });
  }

  async upsertStorefrontAddress(input: {
    email: string;
    addressId?: number;
    label?: string;
    usageTypes: Array<'shipping' | 'billing'>;
    recipientName?: string;
    countryCode: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    postalCode?: string;
    phone?: string;
    deliveryInstructions?: string;
  }): Promise<{
    ok: boolean;
    id?: string;
    reason?: string;
    raw?: Record<string, unknown>;
  }> {
    if (!this.isLive()) {
      return { ok: false, reason: 'odoo_offline' };
    }
    const row = await this.odoo.executeKw<Record<string, unknown>>(
      'res.partner',
      'bt_upsert_storefront_address',
      [
        {
          email: input.email,
          address_id: input.addressId,
          label: input.label,
          usage_types: input.usageTypes,
          recipient_name: input.recipientName,
          country_code: input.countryCode,
          address_line1: input.addressLine1,
          address_line2: input.addressLine2,
          city: input.city,
          postal_code: input.postalCode,
          phone: input.phone,
          delivery_instructions: input.deliveryInstructions,
        },
      ],
    );
    if (!row?.ok) {
      return { ok: false, reason: row?.reason ? String(row.reason) : 'upsert_failed', raw: row };
    }
    return {
      ok: true,
      id: row.id != null ? `odoo:${Number(row.id)}` : undefined,
      raw: row,
    };
  }

  async listStorefrontContacts(email: string): Promise<
    Array<{
      id: string;
      label?: string;
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      mobile?: string;
      jobTitle?: string;
      companyName?: string;
    }>
  > {
    if (!this.isLive()) {
      return [];
    }
    const row = await this.odoo.executeKw<{ items?: Array<Record<string, unknown>> }>(
      'res.partner',
      'bt_list_storefront_contacts',
      [email],
    );
    const items = Array.isArray(row?.items) ? row.items : [];
    return items.map((item) => ({
      id: `odoo:${Number(item.id)}`,
      label: item.label ? String(item.label) : undefined,
      firstName: String(item.first_name || ''),
      lastName: String(item.last_name || ''),
      email: item.email ? String(item.email) : undefined,
      phone: item.phone ? String(item.phone) : undefined,
      mobile: item.mobile ? String(item.mobile) : undefined,
      jobTitle: item.job_title ? String(item.job_title) : undefined,
      companyName: item.company_name ? String(item.company_name) : undefined,
    }));
  }

  async upsertStorefrontContact(input: {
    email: string;
    contactId?: number;
    label?: string;
    firstName: string;
    lastName: string;
    contactEmail?: string;
    phone?: string;
    mobile?: string;
    jobTitle?: string;
    department?: string;
  }): Promise<{
    ok: boolean;
    id?: string;
    reason?: string;
    raw?: Record<string, unknown>;
  }> {
    if (!this.isLive()) {
      return { ok: false, reason: 'odoo_offline' };
    }
    const row = await this.odoo.executeKw<Record<string, unknown>>(
      'res.partner',
      'bt_upsert_storefront_contact',
      [
        {
          email: input.email,
          contact_id: input.contactId,
          label: input.label,
          first_name: input.firstName,
          last_name: input.lastName,
          contact_email: input.contactEmail,
          phone: input.phone,
          mobile: input.mobile,
          job_title: input.jobTitle,
          department: input.department,
        },
      ],
    );
    if (!row?.ok) {
      return { ok: false, reason: row?.reason ? String(row.reason) : 'upsert_failed', raw: row };
    }
    return {
      ok: true,
      id: row.id != null ? `odoo:${Number(row.id)}` : undefined,
      raw: row,
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

  /**
   * Create/update a company-type partner for storefront business registration.
   * Sets ``bt_info_verification=pending`` and links the contact under the company.
   */
  async syncBusinessCompany(input: {
    email: string;
    contactName?: string;
    phone?: string;
    companyName: string;
    organizationNameAr?: string;
    vatNumber?: string;
    crNumber?: string;
    invitationCode?: string;
    shippingAddress?: Record<string, unknown>;
    billingAddress?: Record<string, unknown>;
  }): Promise<{ partnerId: number | null; contactPartnerId?: number; infoVerification?: string }> {
    if (!this.isLive()) {
      return { partnerId: null };
    }
    const email = input.email.trim();
    if (!email || !input.companyName?.trim()) {
      return { partnerId: null };
    }
    const result = await this.odoo.executeKw<{
      updated?: boolean;
      partner_id?: number;
      contact_partner_id?: number;
      info_verification?: string;
      reason?: string;
    }>('res.partner', 'bt_sync_storefront_profile', [
      {
        email,
        name: input.contactName || email.split('@')[0] || email,
        phone: input.phone,
        account_type: 'business',
        is_company: true,
        company_name: input.companyName.trim(),
        organization_name_ar: input.organizationNameAr,
        vat: input.vatNumber,
        company_registry: input.crNumber,
        invitation_code: input.invitationCode,
        segment: 'b2b',
        approval_status: 'pending',
        shipping_address: input.shippingAddress,
        billing_address: input.billingAddress,
      },
    ]);
    const partnerId = result?.partner_id ? Number(result.partner_id) : null;
    if (!partnerId) {
      this.logger.warn(
        `Odoo business company sync returned no partner_id for ${email}: ${JSON.stringify(result)}`,
      );
      return { partnerId: null };
    }
    this.logger.log(
      `Odoo business company synced ${email} → company ${partnerId} (info_verification=pending)`,
    );
    return {
      partnerId,
      contactPartnerId: result?.contact_partner_id
        ? Number(result.contact_partner_id)
        : undefined,
      infoVerification: result?.info_verification || 'pending',
    };
  }

  async attachStorefrontDocument(input: {
    partnerId?: number;
    email?: string;
    documentType: string;
    fileName: string;
    mimeType: string;
    dataBase64: string;
  }): Promise<{
    ok: boolean;
    attachmentId?: number;
    partnerId?: number;
    reason?: string;
  }> {
    if (!this.isLive()) {
      return { ok: false, reason: 'odoo_offline' };
    }
    const row = await this.odoo.executeKw<{
      ok?: boolean;
      attachment_id?: number;
      partner_id?: number;
      reason?: string;
    }>('res.partner', 'bt_attach_storefront_document', [
      {
        partner_id: input.partnerId,
        email: input.email,
        document_type: input.documentType,
        file_name: input.fileName,
        mimetype: input.mimeType,
        datas: input.dataBase64,
      },
    ]);
    return {
      ok: Boolean(row?.ok),
      attachmentId: row?.attachment_id ? Number(row.attachment_id) : undefined,
      partnerId: row?.partner_id ? Number(row.partner_id) : undefined,
      reason: row?.reason,
    };
  }

  async storefrontUserExists(identifier: string): Promise<{
    exists: boolean;
    partnerId?: number;
    email?: string;
  }> {
    const row = await this.odoo.executeKw<{
      exists?: boolean;
      partner_id?: number | false;
      email?: string | false;
    }>('res.partner', 'bt_storefront_user_exists', [identifier]);
    return {
      exists: Boolean(row?.exists),
      partnerId: row?.partner_id ? Number(row.partner_id) : undefined,
      email: row?.email ? String(row.email) : undefined,
    };
  }

  async storefrontRegister(input: {
    email: string;
    name?: string;
    phone?: string;
    passwordHash: string;
    segment?: 'b2c' | 'b2b';
    approvalStatus?: 'pending' | 'approved' | 'rejected';
  }): Promise<StorefrontAuthProfile> {
    const row = await this.odoo.executeKw<OdooAuthProfile>(
      'res.partner',
      'bt_storefront_register',
      [
        {
          email: input.email,
          name: input.name,
          phone: input.phone,
          password_hash: input.passwordHash,
          segment: input.segment ?? 'b2c',
          approval_status: input.approvalStatus,
        },
      ],
    );
    return this.mapAuthProfile(row);
  }

  async storefrontAuthenticate(input: {
    email: string;
    password: string;
  }): Promise<StorefrontAuthProfile> {
    const row = await this.odoo.executeKw<OdooAuthProfile>(
      'res.partner',
      'bt_storefront_authenticate',
      [
        {
          email: input.email,
          password: input.password,
        },
      ],
    );
    return this.mapAuthProfile(row);
  }

  async storefrontSetPassword(input: {
    email: string;
    passwordHash: string;
  }): Promise<StorefrontAuthProfile> {
    const row = await this.odoo.executeKw<OdooAuthProfile>(
      'res.partner',
      'bt_storefront_set_password',
      [
        {
          email: input.email,
          password_hash: input.passwordHash,
        },
      ],
    );
    return this.mapAuthProfile(row);
  }

  async getAuthProfile(input: {
    partnerId?: number;
    email?: string;
  }): Promise<StorefrontAuthProfile> {
    const row = await this.odoo.executeKw<OdooAuthProfile>(
      'res.partner',
      'bt_storefront_get_auth_profile',
      [
        {
          partner_id: input.partnerId,
          email: input.email,
        },
      ],
    );
    return this.mapAuthProfile(row);
  }

  async submitCreditAccount(input: {
    email: string;
    application: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    partnerId?: number;
    hasCreditAccount?: boolean;
    creditAccountApproved?: boolean;
    creditLimitApproved?: number;
    reason?: string;
  }> {
    const row = await this.odoo.executeKw<{
      ok?: boolean;
      partner_id?: number;
      has_credit_account?: boolean;
      credit_account_approved?: boolean;
      credit_limit_approved?: number;
      reason?: string;
    }>('res.partner', 'bt_submit_credit_account', [
      {
        email: input.email,
        application: input.application,
      },
    ]);
    return {
      ok: Boolean(row?.ok),
      partnerId: row?.partner_id,
      hasCreditAccount: Boolean(row?.has_credit_account),
      creditAccountApproved: Boolean(row?.credit_account_approved),
      creditLimitApproved: Number(row?.credit_limit_approved ?? 0) || 0,
      reason: row?.reason,
    };
  }
}
