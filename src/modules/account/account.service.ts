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
    const credits = this.persistence.creditsLedger.get(userId);
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
    const creditLimit = odoo?.creditLimit ?? 0;
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
      avatar: {
        url: null as string | null,
        initials:
          (odoo?.name ?? u.displayName ?? u.email).slice(0, 2).toUpperCase() || 'BT',
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
        creditsWithdrawEnabled: segment === 'b2b',
        listsEnabled: true,
        b2bCheckoutEnabled: segment === 'b2b' && approvalStatus === 'approved',
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
          (`${dto.firstName ?? u.firstName ?? ''} ${dto.lastName ?? u.lastName ?? ''}`.trim() ||
            u.displayName);
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

  credits(userId: string, tab = 'credits', status = 'all', page = 1, pageSize = 20) {
    this.user(userId);
    const ledger = this.persistence.creditsLedger.get(userId);
    const balanceAmount = ledger?.balanceAmount ?? 0;
    const currency = ledger?.currency ?? 'SAR';
    const txs = [
      {
        id: newId(),
        createdAt: new Date().toISOString(),
        type: 'purchase',
        typeLabel: 'Purchase',
        details: 'Opening mock balance',
        reference: 'MOCK-1',
        amount: {
          currency,
          amount: balanceAmount,
          formatted: `${balanceAmount.toLocaleString('en-SA')} SAR`,
        },
        direction: 'credit',
        runningBalance: {
          currency,
          amount: balanceAmount,
          formatted: `${balanceAmount.toLocaleString('en-SA')} SAR`,
        },
      },
    ];
    const row = paginate(txs, page, pageSize);
    return {
      balance: {
        currency,
        amount: balanceAmount,
        formatted: `${balanceAmount.toLocaleString('en-SA')} SAR`,
      },
      tab,
      statusFilter: status,
      transactions: row.items,
      pagination: row.pagination,
    };
  }

  withdraw(userId: string, dto: WithdrawCreditsDto) {
    const u = this.user(userId);
    if (u.segment !== 'b2b') {
      throw new ForbiddenException('Withdrawals limited to B2B accounts');
    }
    return {
      withdrawalId: newId(),
      status: 'pending' as const,
    };
  }

  listAddresses(userId: string, usage: string, defaultsOnly: boolean) {
    this.user(userId);
    let items = [...this.persistence.getUserAddresses(userId).values()];
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

  createAddress(userId: string, dto: AddressInputDto) {
    this.user(userId);
    const now = new Date().toISOString();
    const row: AddressEntity = {
      id: newId(),
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

  listContacts(userId: string, usage: string, defaultsOnly: boolean) {
    this.user(userId);
    const all = [...this.persistence.getUserContacts(userId).values()];
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

  createContact(userId: string, dto: ContactInputDto) {
    this.user(userId);
    const now = new Date().toISOString();
    const row: ContactEntity = {
      id: newId(),
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
    return {
      items: [] as Array<{
        id: string;
        type: string;
        last4: string;
      }>,
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
    const cur =
      this.persistence.notificationPrefs.get(userId) ??
      ({
        orderUpdates: true,
        promotions: false,
        creditAlerts: true,
        smsEnabled: false,
      } as NotificationPrefsDto);
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
    }));
    return paginate(rows, page, pageSize);
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
          : latest
            ? ('submitted' as const)
            : ('none' as const);
    return {
      status,
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
          } catch (err) {
            this.logger.warn(
              `Odoo B2B signup sync failed for ${u.email}: ${
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
}
