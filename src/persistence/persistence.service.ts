/**
 * In-process session/store for the Commerce API.
 *
 * Holds ephemeral users, auth challenges, carts, checkout drafts, payment
 * intents, address/contact books, quotes, and local orders. Durable customer
 * credentials and orders live in Odoo when live; Redis is used only for
 * idempotency keys (with an in-memory fallback).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { newId } from '../common/utils/uuid';
import { hashPassword } from '../common/utils/crypto-password';
import { RedisService } from '../infrastructure/redis/redis.module';
import type { UserSegment } from '../modules/auth/auth.types';

export interface StoredUser {
  id: string;
  email: string;
  /**
   * Fixture-mode only. Live mode stores hashes on ``res.partner`` in Odoo and
   * never treats this field as durable credentials.
   */
  passwordHash?: string;
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
  /** Last delivery channel used for OTP (mobile defaults to whatsapp). */
  otpChannel?: 'email' | 'sms' | 'whatsapp';
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
  promoCode?: string | null;
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
  buildingNo?: string;
  street?: string;
  secondary?: string;
  district?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  formattedAddress?: string;
  addressKind?: 'home' | 'work' | 'business' | 'pickup';
  warehouseSlug?: string;
  portOfDestination?: string;
  freightType?: string;
  nationalAddress?: string;
  companyFloor?: string;
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
  method: 'card' | 'apple_pay' | 'cod' | 'wire';
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
  purchaseOrderNumber?: string | null;
  orderNotes?: string | null;
  items: OrderLineEntity[];
  totals: {
    currency: string;
    subtotal: number;
    discount?: number;
    vat?: number;
    shipping: number;
    grandTotal: number;
    formattedSubtotal: string;
    formattedDiscount?: string;
    formattedVat?: string;
    formattedShipping: string;
    formattedGrandTotal: string;
  };
  shippingOptionId: string;
  shippingLabel: string;
  paymentMethod?: 'card' | 'apple_pay' | 'cod' | 'wire' | null;
  paymentProvider?: string | null;
  paymentStatus?: string | null;
  paytabsTranRef?: string | null;
}

@Injectable()
export class PersistenceService implements OnModuleInit {
  private readonly logger = new Logger(PersistenceService.name);

  // --- Auth / session ---
  readonly usersById = new Map<string, StoredUser>();
  readonly usersByEmail = new Map<string, string>();
  readonly authChallenges = new Map<string, AuthChallengeRecord>();
  readonly resetTokens = new Map<string, ResetTokenRecord>();
  readonly resetSessions = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  // --- Cart / checkout / payments ---
  readonly carts = new Map<string, CartEntity>();
  readonly checkoutDrafts = new Map<string, CheckoutDraftEntity>();
  readonly paymentIntentsById = new Map<string, PaymentIntentEntity>();
  readonly paymentIntentsByTranRef = new Map<string, string>();

  // --- Account books ---
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

  // --- Quotes / B2B / local order cache ---
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
    // Durable credentials live in Odoo when live; seed only for fixture/e2e.
    if (process.env.ODOO_MODE !== 'live') {
      this.seedDemoUser();
    } else {
      this.logger.log(
        'ODOO_MODE=live — skipping in-memory demo credentials (Odoo is SSOT)',
      );
    }
  }

  /** Ephemeral session projection for account/cart lookups (not credential SSOT). */
  cacheSessionUser(user: StoredUser): void {
    this.usersById.set(user.id, user);
    this.usersByEmail.set(user.email.toLowerCase(), user.id);
    if (!this.notificationPrefs.has(user.id)) {
      this.notificationPrefs.set(user.id, {
        orderUpdates: true,
        promotions: false,
        creditAlerts: true,
        smsEnabled: false,
      });
    }
    if (!this.creditsLedger.has(user.id)) {
      this.creditsLedger.set(user.id, {
        balanceAmount: 0,
        currency: 'SAR',
      });
    }
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
    this.cacheSessionUser(user);
    this.creditsLedger.set(id, { balanceAmount: 1250.5, currency: 'SAR' });
  }

  /** Read a cached idempotent HTTP response (Redis `idem:` key or memory). */
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

  /** Store an idempotent HTTP response with TTL (Redis preferred). */
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

  /** Lazily create the saved-lists bucket for a user. */
  getUserLists(userId: string): Map<string, SavedListEntity> {
    let m = this.listsByUser.get(userId);
    if (!m) {
      m = new Map();
      this.listsByUser.set(userId, m);
    }
    return m;
  }

  /** Lazily create the address-book bucket for a user. */
  getUserAddresses(userId: string): Map<string, AddressEntity> {
    let m = this.addressesByUser.get(userId);
    if (!m) {
      m = new Map();
      this.addressesByUser.set(userId, m);
    }
    return m;
  }

  /** Lazily create the contacts bucket for a user. */
  getUserContacts(userId: string): Map<string, ContactEntity> {
    let m = this.contactsByUser.get(userId);
    if (!m) {
      m = new Map();
      this.contactsByUser.set(userId, m);
    }
    return m;
  }

  /** Lazily create the quotes bucket for a user. */
  getUserQuotes(userId: string): Map<string, QuoteStubEntity> {
    let m = this.quotesByUser.get(userId);
    if (!m) {
      m = new Map();
      this.quotesByUser.set(userId, m);
    }
    return m;
  }

  /** Local order history cache (fallback when Odoo list fails / offline). */
  getUserOrders(userId: string): OrderEntity[] {
    return this.ordersByUser.get(userId) ?? [];
  }

  /** Prepend a locally recorded order after checkout submit. */
  addOrder(order: OrderEntity): void {
    const rows = this.ordersByUser.get(order.userId) ?? [];
    rows.unshift(order);
    this.ordersByUser.set(order.userId, rows);
  }
}
