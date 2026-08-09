import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import { OdooOrderService } from '../../infrastructure/odoo/odoo-order.service';
import { OdooCustomerService } from '../../infrastructure/odoo/odoo-customer.service';
import type {
  AddressEntity,
  ContactEntity,
  CreditApplicationEntity,
  StoredUser,
} from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';
import type {
  AddressInputDto,
  ContactInputDto,
  CreditApplicationDto,
  NotificationPrefsDto,
  UpdateProfileDto,
  WithdrawCreditsDto,
} from './account.dto';

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const slice = items.slice((page - 1) * pageSize, page * pageSize);
  return {
    items: slice,
    pagination: { page, pageSize, total, totalPages },
  };
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly odooOrders: OdooOrderService,
    private readonly odooCustomers: OdooCustomerService,
  ) {}

  private async odooProfile(email: string) {
    if (!this.odooCustomers.isLive()) {
      return null;
    }
    try {
      const profile = await this.odooCustomers.getStorefrontAccount(email);
      return profile.found ? profile : null;
    } catch (err) {
      this.logger.warn(
        `Odoo customer profile failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private formatMoney(amount: number, currency = 'SAR'): string {
    return `${amount.toLocaleString('en-SA')} ${currency}`;
  }

  private user(userId: string): StoredUser {
    const u = this.persistence.usersById.get(userId);
    if (!u) {
      throw new NotFoundException('User not found');
    }
    return u;
  }

  async summary(userId: string) {
    const u = this.user(userId);
    const odoo = await this.odooProfile(u.email);
    const segment = odoo?.segment ?? u.segment;
    const approvalStatus = odoo?.approvalStatus ?? u.approvalStatus;
    const listsCount = this.persistence.getUserLists(userId).size;
    const approval =
      segment === 'b2b'
        ? approvalStatus === 'approved'
          ? 'approved'
          : approvalStatus === 'pending'
            ? 'pending'
            : 'none'
        : 'none';
    const currency = odoo?.currency ?? 'SAR';
    const creditLimit =
      Number(odoo?.creditLimitApproved ?? 0) || odoo?.creditLimit ?? 0;
    return {
      id: u.id,
      displayName:
        odoo?.name ??
        u.displayName ??
        (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email),
      email: u.email,
      phone: odoo?.phone || u.phone || null,
      segment,
      approvalStatus: approval,
      infoVerification: odoo?.infoVerification ?? null,
      businessProfileComplete:
        segment === 'b2b' &&
        (odoo?.infoVerification === 'pending' ||
          odoo?.infoVerification === 'verified' ||
          approvalStatus === 'pending' ||
          approvalStatus === 'approved'),
      avatar: {
        url: null as string | null,
        initials:
          (odoo?.name ?? u.displayName ?? u.email).slice(0, 2).toUpperCase() ||
          'BT',
      },
      profileCompletion: {
        percent: 60,
        missingFields: ['shipping_address'],
      },
      business:
        segment === 'b2b' && approvalStatus === 'approved'
          ? {
              companyName: odoo?.companyName || odoo?.name || 'B2B Account',
              creditLimit: {
                currency,
                amount: creditLimit,
                formatted: this.formatMoney(creditLimit, currency),
              },
              availableCredit: {
                currency,
                amount: creditLimit,
                formatted: this.formatMoney(creditLimit, currency),
              },
              paymentTerms: 'Net 30',
            }
          : null,
      navBadges: { orders: 0, returns: 0, lists: listsCount },
      capabilities: {
        creditsEnabled: true,
        creditsWithdrawEnabled:
          segment === 'b2b' && Boolean(odoo?.creditAccountApproved),
        listsEnabled: true,
        b2bCheckoutEnabled: segment === 'b2b' && approvalStatus === 'approved',
        hasCreditAccount: Boolean(odoo?.hasCreditAccount),
        creditAccountApproved: Boolean(odoo?.creditAccountApproved),
      },
    };
  }

  getProfile(userId: string) {
    const u = this.user(userId);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: u.displayName,
      email: u.email,
      phone: u.phone,
      preferredLanguage: u.preferredLanguage ?? 'en',
      marketingOptIn: u.marketingOptIn ?? false,
      segment: u.segment,
    };
  }

  async patchProfile(userId: string, dto: UpdateProfileDto) {
    const u = this.user(userId);
    Object.assign(u, dto);
    if (this.odooCustomers.isLive()) {
      try {
        const name =
          `${dto.firstName ?? u.firstName ?? ''} ${dto.lastName ?? u.lastName ?? ''}`.trim() ||
          u.displayName;
        await this.odooCustomers.syncStorefrontProfile({
          email: u.email,
          name,
          phone: dto.phone ?? u.phone,
        });
      } catch (err) {
        this.logger.warn(
          `Odoo profile sync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return this.getProfile(userId);
  }

  async credits(
    userId: string,
    tab = 'credits',
    status = 'all',
    page = 1,
    pageSize = 20,
  ) {
    const u = this.user(userId);
    const odoo = await this.odooProfile(u.email);
    const currency = odoo?.currency ?? 'SAR';
    const hasCreditAccount = Boolean(odoo?.hasCreditAccount);
    const creditAccountApproved = Boolean(odoo?.creditAccountApproved);
    const creditLimitApproved = Number(odoo?.creditLimitApproved ?? 0) || 0;
    const accountInfo =
      odoo?.creditAccountInfo && typeof odoo.creditAccountInfo === 'object'
        ? odoo.creditAccountInfo
        : null;

    const txs: Array<Record<string, unknown>> = [];
    if (hasCreditAccount && accountInfo) {
      const billing =
        accountInfo.billing && typeof accountInfo.billing === 'object'
          ? (accountInfo.billing as Record<string, unknown>)
          : {};
      const preferences =
        accountInfo.preferences && typeof accountInfo.preferences === 'object'
          ? (accountInfo.preferences as Record<string, unknown>)
          : {};
      const desired = Number(preferences.creditLimitDesired ?? 0) || 0;
      txs.push({
        id: 'credit-application',
        createdAt: new Date().toISOString(),
        type: creditAccountApproved ? 'approved' : 'application',
        typeLabel: creditAccountApproved ? 'Approved' : 'Application submitted',
        details: String(billing.companyName || 'Credit account application'),
        reference: creditAccountApproved ? 'APPROVED' : 'PENDING',
        amount: {
          currency,
          amount: creditAccountApproved ? creditLimitApproved : desired,
          formatted: this.formatMoney(
            creditAccountApproved ? creditLimitApproved : desired,
            currency,
          ),
        },
        direction: 'credit',
        runningBalance: {
          currency,
          amount: creditLimitApproved,
          formatted: this.formatMoney(creditLimitApproved, currency),
        },
      });
    }

    const row = paginate(txs, page, pageSize);
    return {
      hasCreditAccount,
      creditAccountApproved,
      creditLimitApproved: {
        currency,
        amount: creditLimitApproved,
        formatted: this.formatMoney(creditLimitApproved, currency),
      },
      accountInfo,
      balance: {
        currency,
        amount: creditLimitApproved,
        formatted: this.formatMoney(creditLimitApproved, currency),
      },
      tab,
      statusFilter: status,
      transactions: row.items,
      pagination: row.pagination,
    };
  }

  withdraw(userId: string, dto: WithdrawCreditsDto) {
    void dto;
    const u = this.user(userId);
    if (u.segment !== 'b2b') {
      throw new ForbiddenException('Withdrawals limited to B2B accounts');
    }
    return {
      withdrawalId: newId(),
      status: 'pending' as const,
    };
  }

  async listAddresses(userId: string, usage: string, defaultsOnly: boolean) {
    const u = this.user(userId);
    const memoryItems = [...this.persistence.getUserAddresses(userId).values()];
    const byKey = new Map<string, (typeof memoryItems)[number]>();

    for (const row of memoryItems) {
      const key = `${String(row.addressLine1 || '')
        .trim()
        .toLowerCase()}|${String(row.city || '')
        .trim()
        .toLowerCase()}|${String(row.postalCode || '')
        .trim()
        .toLowerCase()}`;
      byKey.set(key || row.id, row);
    }

    if (this.odooCustomers.isLive() && u.email) {
      try {
        const odooItems = await this.odooCustomers.listStorefrontAddresses(u.email);
        const now = new Date().toISOString();
        for (const item of odooItems) {
          const key = `${item.addressLine1.trim().toLowerCase()}|${item.city
            .trim()
            .toLowerCase()}|${String(item.postalCode || '')
            .trim()
            .toLowerCase()}`;
          if (byKey.has(key)) {
            continue;
          }
          const row = {
            id: item.id,
            userId,
            createdAt: now,
            updatedAt: now,
            label: item.label,
            usageTypes: item.usageTypes,
            companyName: item.companyName,
            recipientName: item.recipientName,
            countryCode: item.countryCode,
            addressLine1: item.addressLine1,
            addressLine2: item.addressLine2,
            city: item.city,
            postalCode: item.postalCode,
            phone: item.phone,
            formattedAddress: item.formattedAddress,
            isDefaultShipping: item.isDefaultShipping,
            isDefaultBilling: item.isDefaultBilling,
          };
          byKey.set(key || item.id, row);
          // Hydrate ephemeral session cache so checkout address-book can reuse them.
          this.persistence.getUserAddresses(userId).set(row.id, row);
        }
      } catch (err) {
        this.logger.warn(
          `Odoo address list failed for ${u.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    let items = [...byKey.values()];
    if (usage === 'shipping') {
      items = items.filter((a) => a.usageTypes.includes('shipping'));
    }
    if (usage === 'billing') {
      items = items.filter((a) => a.usageTypes.includes('billing'));
    }
    if (defaultsOnly) {
      items = items.filter((a) => a.isDefaultShipping || a.isDefaultBilling);
    }
    const defaults = {
      shipping: items.find((a) => a.isDefaultShipping) ?? null,
      billing: items.find((a) => a.isDefaultBilling) ?? null,
    };
    return {
      items,
      defaults,
      limits: { maxAddresses: 20, remaining: Math.max(0, 20 - items.length) },
    };
  }

  async createAddress(userId: string, dto: AddressInputDto) {
    const u = this.user(userId);
    const now = new Date().toISOString();
    let id = newId();

    if (this.odooCustomers.isLive() && u.email) {
      try {
        const synced = await this.odooCustomers.upsertStorefrontAddress({
          email: u.email,
          label: dto.label,
          usageTypes: dto.usageTypes,
          recipientName: dto.recipientName,
          countryCode: dto.countryCode,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2,
          city: dto.city,
          postalCode: dto.postalCode,
          phone: dto.phone,
          deliveryInstructions: dto.deliveryInstructions,
        });
        if (synced.ok && synced.id) {
          id = synced.id;
        } else {
          this.logger.warn(
            `Odoo address create failed for ${u.email}: ${synced.reason ?? 'unknown'}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Odoo address create error for ${u.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const row: AddressEntity = {
      id,
      userId,
      createdAt: now,
      updatedAt: now,
      label: dto.label,
      usageTypes: dto.usageTypes,
      companyName: dto.companyName,
      recipientName: dto.recipientName,
      countryCode: dto.countryCode,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      stateCode: dto.stateCode,
      postalCode: dto.postalCode,
      phone: dto.phone,
      deliveryInstructions: dto.deliveryInstructions,
      buildingNo: dto.buildingNo,
      street: dto.street,
      secondary: dto.secondary,
      district: dto.district,
      landmark: dto.landmark,
      latitude: dto.latitude,
      longitude: dto.longitude,
      placeId: dto.placeId,
      formattedAddress: dto.formattedAddress,
      addressKind: dto.addressKind,
      warehouseSlug: dto.warehouseSlug,
      portOfDestination: dto.portOfDestination,
      freightType: dto.freightType,
      nationalAddress: dto.nationalAddress,
      companyFloor: dto.companyFloor,
      isDefaultShipping: dto.isDefaultShipping ?? false,
      isDefaultBilling: dto.isDefaultBilling ?? false,
    };
    this.persistence.getUserAddresses(userId).set(row.id, row);
    return row;
  }

  patchAddress(userId: string, addressId: string, dto: AddressInputDto) {
    const row = this.persistence.getUserAddresses(userId).get(addressId);
    if (!row) {
      throw new NotFoundException('Address not found');
    }
    Object.assign(row, dto, { updatedAt: new Date().toISOString() });
    return row;
  }

  deleteAddress(userId: string, addressId: string) {
    const ok = this.persistence.getUserAddresses(userId).delete(addressId);
    if (!ok) {
      throw new NotFoundException('Address not found');
    }
  }

  setDefaultAddress(userId: string, addressId: string, type: string) {
    const row = this.persistence.getUserAddresses(userId).get(addressId);
    if (!row) {
      throw new NotFoundException('Address not found');
    }
    if (type === 'shipping') {
      for (const a of this.persistence.getUserAddresses(userId).values()) {
        a.isDefaultShipping = false;
      }
      row.isDefaultShipping = true;
    } else if (type === 'billing') {
      for (const a of this.persistence.getUserAddresses(userId).values()) {
        a.isDefaultBilling = false;
      }
      row.isDefaultBilling = true;
    } else {
      throw new BadRequestException('Invalid default type');
    }
    row.updatedAt = new Date().toISOString();
    return row;
  }

  private contactOut(row: ContactEntity) {
    return {
      ...row,
      fullName: `${row.firstName} ${row.lastName}`,
    };
  }

  async listContacts(userId: string, usage: string, defaultsOnly: boolean) {
    const u = this.user(userId);
    const memoryItems = [...this.persistence.getUserContacts(userId).values()];
    const byId = new Map(memoryItems.map((c) => [c.id, c]));

    if (this.odooCustomers.isLive() && u.email) {
      try {
        const odooItems = await this.odooCustomers.listStorefrontContacts(u.email);
        const now = new Date().toISOString();
        for (const item of odooItems) {
          if (byId.has(item.id)) continue;
          const row: ContactEntity = {
            id: item.id,
            userId,
            createdAt: now,
            updatedAt: now,
            label: item.label,
            usageTypes: ['delivery'],
            firstName: item.firstName,
            lastName: item.lastName,
            email: item.email || '',
            phone: item.phone || '',
            mobile: item.mobile ?? null,
            jobTitle: item.jobTitle,
            department: undefined,
            companyName: item.companyName,
            isDefaultDelivery: false,
            isDefaultOrderNotifications: false,
            isDefaultBilling: false,
          };
          byId.set(row.id, row);
          this.persistence.getUserContacts(userId).set(row.id, row);
        }
      } catch (err) {
        this.logger.warn(
          `Odoo contact list failed for ${u.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const all = [...byId.values()];
    let items = all;
    if (usage !== 'all') {
      items = items.filter((c) => c.usageTypes.includes(usage as never));
    }
    if (defaultsOnly) {
      items = items.filter(
        (c) =>
          c.isDefaultBilling ||
          c.isDefaultDelivery ||
          c.isDefaultOrderNotifications,
      );
    }
    const defDelivery = all.find((c) => c.isDefaultDelivery);
    const defOn = all.find((c) => c.isDefaultOrderNotifications);
    const defBill = all.find((c) => c.isDefaultBilling);
    return {
      items: items.map((c) => this.contactOut(c)),
      defaults: {
        delivery: defDelivery ? this.contactOut(defDelivery) : null,
        orderNotifications: defOn ? this.contactOut(defOn) : null,
        billing: defBill ? this.contactOut(defBill) : null,
      },
      limits: {
        maxContacts: 30,
        remaining: Math.max(0, 30 - all.length),
      },
    };
  }

  async createContact(userId: string, dto: ContactInputDto) {
    const u = this.user(userId);
    const now = new Date().toISOString();
    let id = newId();

    if (this.odooCustomers.isLive() && u.email) {
      try {
        const synced = await this.odooCustomers.upsertStorefrontContact({
          email: u.email,
          label: dto.label,
          firstName: dto.firstName,
          lastName: dto.lastName,
          contactEmail: dto.email,
          phone: dto.phone,
          mobile: dto.mobile ?? undefined,
          jobTitle: dto.jobTitle,
          department: dto.department,
        });
        if (synced.ok && synced.id) {
          id = synced.id;
        } else {
          this.logger.warn(
            `Odoo contact create failed for ${u.email}: ${synced.reason ?? 'unknown'}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Odoo contact create error for ${u.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const row: ContactEntity = {
      id,
      userId,
      createdAt: now,
      updatedAt: now,
      label: dto.label,
      usageTypes: dto.usageTypes,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      mobile: dto.mobile ?? null,
      jobTitle: dto.jobTitle,
      department: dto.department,
      companyName: dto.companyName,
      isDefaultDelivery: dto.isDefaultDelivery ?? false,
      isDefaultOrderNotifications: dto.isDefaultOrderNotifications ?? false,
      isDefaultBilling: dto.isDefaultBilling ?? false,
    };
    this.persistence.getUserContacts(userId).set(row.id, row);
    return this.contactOut(row);
  }

  getContact(userId: string, contactId: string) {
    const row = this.persistence.getUserContacts(userId).get(contactId);
    if (!row) {
      throw new NotFoundException('Contact not found');
    }
    return this.contactOut(row);
  }

  patchContact(userId: string, contactId: string, dto: ContactInputDto) {
    const row = this.persistence.getUserContacts(userId).get(contactId);
    if (!row) {
      throw new NotFoundException('Contact not found');
    }
    Object.assign(row, dto, { updatedAt: new Date().toISOString() });
    return this.contactOut(row);
  }

  deleteContact(userId: string, contactId: string) {
    const ok = this.persistence.getUserContacts(userId).delete(contactId);
    if (!ok) {
      throw new NotFoundException('Contact not found');
    }
  }

  setDefaultContact(userId: string, contactId: string, type: string) {
    const row = this.persistence.getUserContacts(userId).get(contactId);
    if (!row) {
      throw new NotFoundException('Contact not found');
    }
    const bucket = this.persistence.getUserContacts(userId);
    for (const c of bucket.values()) {
      if (type === 'delivery') {
        c.isDefaultDelivery = false;
      }
      if (type === 'order_notifications') {
        c.isDefaultOrderNotifications = false;
      }
      if (type === 'billing') {
        c.isDefaultBilling = false;
      }
    }
    if (type === 'delivery') {
      row.isDefaultDelivery = true;
    }
    if (type === 'order_notifications') {
      row.isDefaultOrderNotifications = true;
    }
    if (type === 'billing') {
      row.isDefaultBilling = true;
    }
    row.updatedAt = new Date().toISOString();
    return this.contactOut(row);
  }

  paymentMethods(_userId: string) {
    void _userId;
    return {
      items: [] as Array<{
        id: string;
        type: string;
        last4: string;
      }>,
    };
  }

  async payments(userId: string, page = 1, pageSize = 50) {
    const orders = await this.orders(userId, page, pageSize);
    const items = (orders.items || []).map((row) => {
      const method = String(
        row.paymentMethod || inferPaymentMethod(row) || 'unknown',
      );
      const status = String(
        row.paymentStatus ||
          defaultPaymentStatus(method, row.status) ||
          'pending',
      );
      const provider = String(
        row.paymentProvider ||
          (method === 'card' || method === 'apple_pay'
            ? 'paytabs'
            : 'storefront'),
      );
      const wireAmount = Number(row.wireTransferAmount);
      const amount =
        method === 'wire' && Number.isFinite(wireAmount) && wireAmount > 0
          ? wireAmount
          : Number(row.total || 0);
      const currency = row.currency || 'SAR';
      return {
        id: `pay-${row.id}`,
        orderId: String(row.id),
        orderNumber: row.orderNumber,
        method,
        methodLabel: paymentMethodLabel(method),
        provider,
        status,
        statusLabel: paymentStatusLabel(status),
        amount,
        currency,
        formattedAmount:
          method === 'wire' && Number.isFinite(wireAmount) && wireAmount > 0
            ? this.formatMoney(amount, currency)
            : row.formattedTotal,
        createdAt: row.createdAt || null,
        tranRef: row.paytabsTranRef || null,
        wireTransferDate: row.wireTransferDate || null,
        wireTransferAmount: row.wireTransferAmount ?? null,
      };
    });
    return {
      items,
      pagination: orders.pagination,
    };
  }

  getNotifications(userId: string) {
    this.user(userId);
    return (
      this.persistence.notificationPrefs.get(userId) ?? {
        orderUpdates: true,
        promotions: false,
        creditAlerts: true,
        smsEnabled: false,
      }
    );
  }

  patchNotifications(userId: string, dto: NotificationPrefsDto) {
    this.user(userId);
    const cur = this.persistence.notificationPrefs.get(userId) ?? {
      orderUpdates: true,
      promotions: false,
      creditAlerts: true,
      smsEnabled: false,
    };
    const next = {
      orderUpdates: dto.orderUpdates ?? cur.orderUpdates ?? true,
      promotions: dto.promotions ?? cur.promotions ?? false,
      creditAlerts: dto.creditAlerts ?? cur.creditAlerts ?? true,
      smsEnabled: dto.smsEnabled ?? cur.smsEnabled ?? false,
    };
    this.persistence.notificationPrefs.set(userId, next);
    return next;
  }

  security(userId: string) {
    this.user(userId);
    return {
      hasPassword: true,
      otpLoginEnabled: true,
      changePasswordUrl: '/auth/password/reset',
      forgotPasswordUrl: '/auth/password/forgot',
    };
  }

  async orders(userId: string, page = 1, pageSize = 20) {
    const u = this.user(userId);
    if (this.odooOrders.isLive()) {
      try {
        const pageResult = await this.odooOrders.listStorefrontOrders(
          u.email,
          page,
          pageSize,
        );
        return {
          items: pageResult.items.map((row) => ({
            id: String(row.id),
            orderNumber: row.orderNumber,
            status: row.status,
            createdAt: row.createdAt || null,
            itemCount: row.itemCount,
            total: row.total,
            currency: row.currency,
            formattedTotal: row.formattedTotal,
            shippingLabel: row.shippingLabel,
            paymentMethod: row.paymentMethod ?? null,
            paymentProvider: row.paymentProvider ?? null,
            paymentStatus: row.paymentStatus ?? null,
            paytabsTranRef: row.paytabsTranRef ?? null,
            wireTransferAmount: row.wireTransferAmount ?? null,
            wireTransferDate: row.wireTransferDate ?? null,
          })),
          pagination: pageResult.pagination,
        };
      } catch (err) {
        this.logger.warn(
          `Odoo order list failed, using local cache: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const rows = this.persistence.getUserOrders(userId).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      createdAt: o.createdAt,
      itemCount: o.items.length,
      total: o.totals.grandTotal,
      currency: o.totals.currency,
      formattedTotal: o.totals.formattedGrandTotal,
      shippingLabel: o.shippingLabel,
      paymentMethod: o.paymentMethod ?? null,
      paymentProvider: o.paymentProvider ?? null,
      paymentStatus: o.paymentStatus ?? null,
      paytabsTranRef: o.paytabsTranRef ?? null,
      wireTransferAmount: null as number | null,
      wireTransferDate: null as string | null,
    }));
    return paginate(rows, page, pageSize);
  }

  async uploadWireReceipt(
    userId: string,
    input: {
      orderId: string;
      orderNumber?: string;
      amount?: string;
      transferDate?: string;
      file:
        | {
            originalname?: string;
            mimetype?: string;
            size?: number;
            buffer?: Buffer;
          }
        | undefined;
    },
  ) {
    const user = this.user(userId);
    if (!input.file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const maxBytes = 10 * 1024 * 1024;
    if ((input.file.size ?? input.file.buffer.length) > maxBytes) {
      throw new BadRequestException('File must be 10 MB or smaller');
    }
    const mime = String(
      input.file.mimetype || 'application/octet-stream',
    ).toLowerCase();
    if (
      !AccountService.BUSINESS_DOC_MIMES.has(mime) &&
      !mime.startsWith('image/') &&
      mime !== 'application/pdf'
    ) {
      throw new BadRequestException('Only PDF or JPEG/PNG files are allowed');
    }

    const amountRaw = String(input.amount || '').trim();
    const amount = amountRaw ? Number(amountRaw) : undefined;
    if (amountRaw && (!Number.isFinite(amount) || Number(amount) <= 0)) {
      throw new BadRequestException('Transfer amount must be a positive number');
    }
    const transferDate = String(input.transferDate || '').trim() || undefined;
    const fileName = String(
      input.file.originalname || 'wire-receipt.bin',
    ).slice(0, 200);
    const dataBase64 = input.file.buffer.toString('base64');
    const orderId = String(input.orderId || '').trim();
    const orderNumber = String(input.orderNumber || '').trim() || undefined;

    if (!this.odooOrders.isLive()) {
      return {
        id: newId(),
        orderId,
        orderNumber: orderNumber || null,
        fileName,
        amount: amount ?? null,
        transferDate: transferDate || null,
        uploadedAt: new Date().toISOString(),
        status: 'submitted',
        synced: false,
        reason: 'odoo_offline',
      };
    }

    try {
      const result = await this.odooOrders.attachWireReceipt({
        orderId,
        orderNumber,
        partnerEmail: user.email,
        amount,
        transferDate,
        fileName,
        mimeType: mime,
        dataBase64,
      });
      if (!result.ok) {
        if (result.reason === 'order_not_found') {
          throw new NotFoundException('Order not found');
        }
        if (result.reason === 'order_not_owned') {
          throw new ForbiddenException('Order does not belong to this account');
        }
        throw new BadRequestException(
          result.reason || 'Could not upload wire transfer receipt',
        );
      }
      return {
        id: String(result.attachmentId ?? newId()),
        orderId: String(result.orderId ?? orderId),
        orderNumber: result.orderNumber || orderNumber || null,
        fileName,
        amount: amount ?? null,
        transferDate: transferDate || null,
        uploadedAt: new Date().toISOString(),
        status: result.paymentStatus || 'wire_receipt_submitted',
        synced: true,
      };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      this.logger.warn(
        `Wire receipt upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException('Could not upload wire transfer receipt');
    }
  }

  returns(userId: string, page = 1) {
    this.user(userId);
    return paginate([], page, 20);
  }

  async business(userId: string) {
    const u = this.user(userId);
    const odoo = await this.odooProfile(u.email);
    const segment = odoo?.segment ?? u.segment;
    const approvalStatus = odoo?.approvalStatus ?? u.approvalStatus;
    if (segment !== 'b2b' || approvalStatus !== 'approved') {
      throw new NotFoundException('Not a B2B customer or not yet approved');
    }
    const currency = odoo?.currency ?? 'SAR';
    const creditLimit = odoo?.creditLimit ?? 0;
    const billing = odoo?.billingAddress;
    return {
      companyName: odoo?.companyName || odoo?.name || 'B2B Account',
      approvalStatus: 'approved' as const,
      billing: {
        countryCode: billing?.country_code || 'SA',
        companyName: odoo?.companyName || odoo?.name || 'B2B Account',
        addressLine1: billing?.address_line1 || '',
        city: billing?.city || 'Riyadh',
        stateCode: 'RY',
        postalCode: billing?.postal_code || '11564',
      },
      preferences: {
        accountsPayablePhone: odoo?.phone || u.phone || '+966500000000',
        accountsPayableEmail: u.email,
        currency,
        creditLimitDesired: creditLimit,
      },
      creditLimit: {
        currency,
        amount: creditLimit,
        formatted: this.formatMoney(creditLimit, currency),
      },
      availableCredit: {
        currency,
        amount: creditLimit,
        formatted: this.formatMoney(creditLimit, currency),
      },
      paymentTerms: 'Net 30',
      accountsPayableEmail: u.email,
    };
  }

  async businessStatus(userId: string) {
    const u = this.user(userId);
    const odoo = await this.odooProfile(u.email);
    const segment = odoo?.segment ?? u.segment;
    const approvalStatus = odoo?.approvalStatus ?? u.approvalStatus;
    const infoVerification = odoo?.infoVerification ?? null;
    if (odoo?.segment === 'b2b') {
      u.segment = 'b2b';
      if (odoo.approvalStatus) {
        u.approvalStatus = odoo.approvalStatus;
      }
      if (odoo.partnerId) {
        u.odooPartnerId = odoo.partnerId;
      }
    }
    const apps = [...this.persistence.creditApplicationsById.values()].filter(
      (a) => a.userId === userId,
    );
    apps.sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
    const latest = apps[0];
    const status =
      segment === 'b2b' && approvalStatus === 'approved'
        ? ('approved' as const)
        : segment === 'b2b' && approvalStatus === 'pending'
          ? ('submitted' as const)
          : infoVerification === 'pending' || infoVerification === 'verified'
            ? ('submitted' as const)
            : latest
              ? ('submitted' as const)
              : ('none' as const);
    const businessProfileComplete =
      segment === 'b2b' &&
      (infoVerification === 'pending' ||
        infoVerification === 'verified' ||
        approvalStatus === 'pending' ||
        approvalStatus === 'approved');
    return {
      status,
      segment: segment === 'b2b' ? ('b2b' as const) : ('b2c' as const),
      infoVerification,
      companyName: odoo?.companyName || (odoo?.isCompany ? odoo?.name : null) || null,
      businessProfileComplete,
      applicationId: latest?.applicationId ?? null,
      submittedAt: latest?.submittedAt ?? null,
      reviewedAt: null as string | null,
      rejectionReason: null as string | null,
    };
  }

  async submitCredit(userId: string | undefined, dto: CreditApplicationDto) {
    const applicationId = newId();
    const entity: CreditApplicationEntity = {
      applicationId,
      userId,
      status: 'submitted',
      payload: dto as unknown as Record<string, unknown>,
      submittedAt: new Date().toISOString(),
      documents: [],
    };
    if (userId) {
      const u = this.persistence.usersById.get(userId);
      if (u) {
        u.segment = 'b2b';
        u.approvalStatus = 'pending';
        if (this.odooCustomers.isLive()) {
          try {
            const companyName = dto.billing?.companyName?.trim();
            const partnerId = await this.odooCustomers.ensureStorefrontSignup({
              email: u.email,
              name: companyName || dto.submitter?.name || u.displayName,
              phone: dto.submitter?.phone || u.phone,
              segment: 'b2b',
              approvalStatus: 'pending',
            });
            if (partnerId) {
              u.odooPartnerId = partnerId;
            }
            const saved = await this.odooCustomers.submitCreditAccount({
              email: u.email,
              application: dto as unknown as Record<string, unknown>,
            });
            if (!saved.ok) {
              this.logger.warn(
                `Odoo credit account submit failed for ${u.email}: ${saved.reason ?? 'unknown'}`,
              );
            }
          } catch (err) {
            this.logger.warn(
              `Odoo B2B credit sync failed for ${u.email}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    }
    this.persistence.creditApplicationsById.set(applicationId, entity);
    return {
      applicationId,
      status: 'submitted' as const,
      message: 'Application accepted for review.',
      estimatedReviewDays: 5,
    };
  }

  uploadCreditDoc(
    userId: string,
    applicationId: string,
    documentType: string,
    fileName: string,
  ) {
    const row = this.persistence.creditApplicationsById.get(applicationId);
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Application not found');
    }
    const doc = {
      id: newId(),
      documentType,
      fileName,
      uploadedAt: new Date().toISOString(),
    };
    row.documents.push(doc);
    return doc;
  }

  private static readonly BUSINESS_DOC_TYPES = new Set([
    'certificate_of_registration',
    'vat_registration_certificate',
    'national_address_registration',
  ]);

  private static readonly BUSINESS_DOC_MIMES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
  ]);

  async uploadBusinessDocument(
    userId: string,
    documentType: string,
    file:
      | {
          originalname?: string;
          mimetype?: string;
          size?: number;
          buffer?: Buffer;
        }
      | undefined,
  ) {
    const type = String(documentType || '').trim();
    if (!AccountService.BUSINESS_DOC_TYPES.has(type)) {
      throw new BadRequestException(
        'documentType must be certificate_of_registration, vat_registration_certificate, or national_address_registration',
      );
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const maxBytes = 10 * 1024 * 1024;
    if ((file.size ?? file.buffer.length) > maxBytes) {
      throw new BadRequestException('File must be 10 MB or smaller');
    }
    const mime = String(file.mimetype || 'application/octet-stream').toLowerCase();
    if (
      !AccountService.BUSINESS_DOC_MIMES.has(mime) &&
      !mime.startsWith('image/') &&
      mime !== 'application/pdf'
    ) {
      throw new BadRequestException('Only PDF or JPEG/PNG files are allowed');
    }

    const user = this.persistence.usersById.get(userId);
    if (!user?.email) {
      throw new NotFoundException('User not found');
    }

    const fileName = String(file.originalname || `${type}.bin`).slice(0, 200);
    const dataBase64 = file.buffer.toString('base64');

    if (!this.odooCustomers.isLive()) {
      const stub = {
        id: newId(),
        documentType: type,
        fileName,
        uploadedAt: new Date().toISOString(),
        synced: false,
        reason: 'odoo_offline',
      };
      this.logger.warn(
        `Odoo offline — business document ${type} for ${user.email} not persisted`,
      );
      return stub;
    }

    const result = await this.odooCustomers.attachStorefrontDocument({
      partnerId: user.odooPartnerId,
      email: user.email,
      documentType: type,
      fileName,
      mimeType: mime,
      dataBase64,
    });
    if (!result.ok) {
      this.logger.warn(
        `Odoo attach failed for ${user.email} (${type}): ${result.reason}`,
      );
      throw new BadRequestException(
        result.reason === 'company_not_found'
          ? 'Submit the business form first so a company contact exists in Odoo.'
          : 'Could not attach document in Odoo.',
      );
    }
    if (result.partnerId) {
      user.odooPartnerId = result.partnerId;
    }
    return {
      id: String(result.attachmentId ?? newId()),
      documentType: type,
      fileName,
      uploadedAt: new Date().toISOString(),
      synced: true,
      partnerId: result.partnerId,
      attachmentId: result.attachmentId,
    };
  }
}

function inferPaymentMethod(row: {
  paymentMethod?: string | null;
  paymentProvider?: string | null;
  paymentStatus?: string | null;
  paytabsTranRef?: string | null;
  shippingLabel?: string | null;
  status?: string;
}): string | null {
  if (row.paymentMethod) return String(row.paymentMethod).toLowerCase();
  const status = String(row.paymentStatus || '').toLowerCase();
  if (status === 'wire_receipt_submitted') return 'wire';
  if (row.paytabsTranRef) return 'card';
  const provider = String(row.paymentProvider || '').toLowerCase();
  if (provider === 'paytabs') return 'card';
  return null;
}

function defaultPaymentStatus(method: string, orderStatus?: string): string {
  if (method === 'cod') return 'pending';
  if (method === 'wire') return 'pending';
  if (orderStatus === 'sale' || orderStatus === 'done') return 'succeeded';
  return 'pending';
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'card':
      return 'Card';
    case 'apple_pay':
      return 'Apple Pay';
    case 'cod':
      return 'Cash on delivery';
    case 'wire':
      return 'Wire transfer';
    default:
      return method.replace(/_/g, ' ');
  }
}

function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'Paid';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'wire_receipt_submitted':
      return 'Receipt submitted';
    case 'requires_payment_method':
      return 'Awaiting payment';
    case 'requires_confirmation':
      return 'Awaiting confirmation';
    default:
      return status.replace(/_/g, ' ');
  }
}
