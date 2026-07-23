import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { newId } from '../common/utils/uuid';
import { hashPassword } from '../common/utils/crypto-password';
import { RedisService } from '../infrastructure/redis/redis.module';
import type { UserSegment } from '../modules/auth/auth.types';

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  segment: UserSegment;
  approvalStatus: 'pending' | 'approved' | 'rejected' | null;
  phone?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  preferredLanguage?: string;
  marketingOptIn?: boolean;
  /** Odoo ``res.partner`` id when synced to live Odoo. */
  odooPartnerId?: number;
}

export interface AuthChallengeRecord {
  challengeId: string;
  identifier: string;
  identifierType: 'email' | 'mobile';
  intent: 'login' | 'register';
  otpCode?: string;
  otpExpiresAt?: number;
  lastOtpSentAt?: number;
  resetPurpose?: boolean;
}

export interface ResetTokenRecord {
  userId: string;
  expiresAt: number;
}

export interface RefreshTokenRecord {
  userId: string;
  revoked: boolean;
}

export interface CartLineEntity {
  id: string;
  productSlug: string;
  packagingOptionId: string;
  quantity: number;
  palletType: 'unit' | 'partial' | 'full';
}

export interface CartEntity {
  id: string;
  userId?: string;
  items: CartLineEntity[];
  updatedAt: string;
}

export interface CheckoutDraftEntity {
  cartId: string;
  userId: string;
  payload: Record<string, unknown>;
}

export interface SavedListEntity {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  listType: 'wishlist' | 'reorder' | 'project';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  items: SavedListItemEntity[];
}

export interface SavedListItemEntity {
  id: string;
  productSlug: string;
  packagingOptionId: string;
  quantity: number;
  palletType: 'unit' | 'partial' | 'full';
  notes?: string | null;
  sortOrder: number;
  addedAt: string;
}

export interface AddressEntity {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  label?: string;
  usageTypes: Array<'shipping' | 'billing'>;
  companyName?: string;
  recipientName?: string;
  countryCode: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode?: string;
  postalCode?: string;
  phone?: string;
  deliveryInstructions?: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

export interface ContactEntity {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  label?: string;
  usageTypes: Array<
    'delivery' | 'order_notifications' | 'billing' | 'accounts_payable'
  >;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile?: string | null;
  jobTitle?: string;
  department?: string;
  companyName?: string;
  isDefaultDelivery: boolean;
  isDefaultOrderNotifications: boolean;
  isDefaultBilling: boolean;
}

export interface QuoteStubEntity {
  id: string;
  userId: string;
  status: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface CreditApplicationEntity {
  applicationId: string;
  userId?: string;
  status: 'submitted' | 'under_review' | 'approved' | 'rejected';
  payload: Record<string, unknown>;
  submittedAt: string;
  documents: Array<{
    id: string;
    documentType: string;
    fileName: string;
    uploadedAt: string;
  }>;
}

export interface OrderLineEntity {
  id: string;
  productSlug: string;
  productName?: string;
  packagingOptionId: string;
  packagingLabel?: string;
  quantity: number;
  palletType: 'unit' | 'partial' | 'full';
  unitPrice: number;
  totalPrice: number;
}

export interface ContactInquiryEntity {
  id: string;
  title: 'mr' | 'mrs';
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  message: string;
  source?: string;
  status: 'received';
  createdAt: string;
}

export interface PaymentIntentEntity {
  paymentIntentId: string;
  cartId: string;
  userId: string;
  method: 'card' | 'cod' | 'wire';
  amount: number;
  currency: string;
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'succeeded'
    | 'failed';
  clientSecret: string;
  redirectUrl?: string | null;
  tranRef?: string | null;
  gateway: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEntity {
  id: string;
  userId: string;
  odooSaleOrderId?: number;
  orderNumber: string;
  status: string;
  createdAt: string;
  items: OrderLineEntity[];
  totals: {
    currency: string;
    subtotal: number;
    shipping: number;
    grandTotal: number;
    formattedSubtotal: string;
    formattedShipping: string;
    formattedGrandTotal: string;
  };
  shippingOptionId: string;
  shippingLabel: string;
}

@Injectable()
export class PersistenceService implements OnModuleInit {
  private readonly logger = new Logger(PersistenceService.name);

  readonly usersById = new Map<string, StoredUser>();
  readonly usersByEmail = new Map<string, string>();
  readonly authChallenges = new Map<string, AuthChallengeRecord>();
  readonly resetTokens = new Map<string, ResetTokenRecord>();
  readonly resetSessions = new Map<string, { userId: string; expiresAt: number }>();
  readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  readonly carts = new Map<string, CartEntity>();
  readonly checkoutDrafts = new Map<string, CheckoutDraftEntity>();
  readonly paymentIntentsById = new Map<string, PaymentIntentEntity>();
  readonly paymentIntentsByTranRef = new Map<string, string>();

  readonly listsByUser = new Map<string, Map<string, SavedListEntity>>();
  readonly addressesByUser = new Map<string, Map<string, AddressEntity>>();
  readonly contactsByUser = new Map<string, Map<string, ContactEntity>>();

  readonly notificationPrefs = new Map<
    string,
    {
      orderUpdates: boolean;
      promotions: boolean;
      creditAlerts: boolean;
      smsEnabled: boolean;
    }
  >();

  readonly creditsLedger = new Map<
    string,
    { balanceAmount: number; currency: string }
  >();

  readonly quotesByUser = new Map<string, Map<string, QuoteStubEntity>>();
  readonly creditApplicationsById = new Map<string, CreditApplicationEntity>();
  readonly ordersByUser = new Map<string, OrderEntity[]>();
  readonly contactInquiries: ContactInquiryEntity[] = [];

  /** In-memory idempotency fallback when Redis is unavailable */
  private readonly idempotencyMemory = new Map<
    string,
    { expiresAt: number; status: number; body: string }
  >();

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    if (this.redis.enabled) {
      this.logger.log('Redis enabled for idempotency keys');
    }
    this.seedDemoUser();
  }

  private seedDemoUser(): void {
    const email = 'demo@blacktiger.com.sa';
    if (this.usersByEmail.has(email.toLowerCase())) {
      return;
    }
    const id = newId();
    const user: StoredUser = {
      id,
      email,
      passwordHash: hashPassword('Password1!'),
      segment: 'b2c',
      approvalStatus: null,
      displayName: 'Demo Customer',
      firstName: 'Demo',
      lastName: 'Customer',
      preferredLanguage: 'en',
      marketingOptIn: false,
    };
    this.usersById.set(id, user);
    this.usersByEmail.set(email.toLowerCase(), id);
    this.notificationPrefs.set(id, {
      orderUpdates: true,
      promotions: false,
      creditAlerts: true,
      smsEnabled: false,
    });
    this.creditsLedger.set(id, { balanceAmount: 1250.5, currency: 'SAR' });
  }

  async getIdempotentResponse(
    key: string,
  ): Promise<{ status: number; body: unknown } | null> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(`idem:${key}`);
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as { status: number; body: unknown };
        return parsed;
      } catch {
        return null;
      }
    }
    const row = this.idempotencyMemory.get(key);
    if (!row || row.expiresAt < Date.now()) {
      this.idempotencyMemory.delete(key);
      return null;
    }
    try {
      return { status: row.status, body: JSON.parse(row.body) as unknown };
    } catch {
      return null;
    }
  }

  async setIdempotentResponse(
    key: string,
    status: number,
    body: unknown,
    ttlSec: number,
  ): Promise<void> {
    const payload = JSON.stringify({ status, body });
    if (this.redis.enabled) {
      const ok = await this.redis.setex(`idem:${key}`, ttlSec, payload);
      if (ok) return;
    }
    this.idempotencyMemory.set(key, {
      status,
      body: JSON.stringify(body),
      expiresAt: Date.now() + ttlSec * 1000,
    });
  }

  getUserLists(userId: string): Map<string, SavedListEntity> {
    let m = this.listsByUser.get(userId);
    if (!m) {
      m = new Map();
      this.listsByUser.set(userId, m);
    }
    return m;
  }

  getUserAddresses(userId: string): Map<string, AddressEntity> {
    let m = this.addressesByUser.get(userId);
    if (!m) {
      m = new Map();
      this.addressesByUser.set(userId, m);
    }
    return m;
  }

  getUserContacts(userId: string): Map<string, ContactEntity> {
    let m = this.contactsByUser.get(userId);
    if (!m) {
      m = new Map();
      this.contactsByUser.set(userId, m);
    }
    return m;
  }

  getUserQuotes(userId: string): Map<string, QuoteStubEntity> {
    let m = this.quotesByUser.get(userId);
    if (!m) {
      m = new Map();
      this.quotesByUser.set(userId, m);
    }
    return m;
  }

  getUserOrders(userId: string): OrderEntity[] {
    return this.ordersByUser.get(userId) ?? [];
  }

  addOrder(order: OrderEntity): void {
    const rows = this.ordersByUser.get(order.userId) ?? [];
    rows.unshift(order);
    this.ordersByUser.set(order.userId, rows);
  }
}
