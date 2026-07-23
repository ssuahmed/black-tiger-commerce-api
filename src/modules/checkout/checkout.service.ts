import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import { OdooOrderService } from '../../infrastructure/odoo/odoo-order.service';
import { OdooShippingService } from '../../infrastructure/odoo/odoo-shipping.service';
import type {
  AddressEntity,
  CheckoutDraftEntity,
  ContactEntity,
  OrderEntity,
} from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';
import { CatalogProductsProvider } from '../catalog/catalog-products.provider';
import { CartService } from '../cart/cart.service';
import { PaymentService } from '../payment/payment.service';
import { buildStorefrontCheckoutPayload } from './checkout-order.mapper';
import type { CheckoutAddressDto } from './checkout.dto';
import { ShippingRecommendationEngine } from './shipping-recommendation.engine';
import type { ShippingOptionsPayload } from './shipping-recommendation.types';

export interface ResolvedAddr {
  addressId?: string | null;
  label?: string;
  companyName?: string;
  recipientName?: string;
  formatted?: string;
  countryCode?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
}

export interface ResolvedCt {
  contactId?: string | null;
  fullName?: string;
  email?: string;
  phone?: string;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly cartService: CartService,
    private readonly odooOrders: OdooOrderService,
    private readonly odooShipping: OdooShippingService,
    private readonly payments: PaymentService,
    private readonly shippingEngine: ShippingRecommendationEngine,
    private readonly catalogProducts: CatalogProductsProvider,
  ) {}

  ensureOwnership(cartId: string, userId: string) {
    return this.cartService.attachUserIfAnonymous(cartId, userId);
  }

  putAddress(cartId: string, userId: string, dto: CheckoutAddressDto) {
    this.ensureOwnership(cartId, userId);
    const savedIds: Record<string, string | undefined> = {};

    const shipping = this.resolveShippingBlock(userId, dto, savedIds);
    const billing =
      dto.billingSameAsShipping === true
        ? { ...shipping }
        : this.resolveBillingBlock(userId, dto, savedIds);

    const contacts = this.resolveContactsBlock(userId, dto, savedIds);

    const resolved = {
      cartId,
      shipping: shipping,
      billing: billing,
      billingSameAsShipping: dto.billingSameAsShipping ?? false,
      contacts,
      savedIds,
    };

    const prevShipOpt = this.persistence.checkoutDrafts.get(cartId)?.payload[
      'shippingOptionId'
    ] as string | undefined;

    const draft: CheckoutDraftEntity = {
      cartId,
      userId,
      payload: {
        resolved,
        shippingOptionId: prevShipOpt,
      },
    };
    this.persistence.checkoutDrafts.set(cartId, draft);
    return resolved;
  }

  async getSummary(cartId: string, userId: string) {
    this.ensureOwnership(cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(cartId);
    const cart = await this.cartService.getCart(cartId, userId);
    const resolvedAddress = draft?.payload['resolved'] as
      | Record<string, unknown>
      | undefined;
    const addrComplete = !!resolvedAddress?.['shipping'];
    const contactsComplete = !!(
      resolvedAddress &&
      (resolvedAddress['contacts'] as Record<string, unknown> | undefined)?.[
        'delivery'
      ]
    );
    const shippingOptionId = draft?.payload['shippingOptionId'] as
      | string
      | undefined;
    const shippingPayload = await this.shippingOptions(cartId, userId);
    const opts = shippingPayload.options;
    const selected = shippingOptionId
      ? opts.find((o) => o.id === shippingOptionId)
      : undefined;
    const subtotal = cart.totals?.subtotal ?? 0;
    const shippingAmount = selected?.price?.amount ?? 0;
    const grandTotal = subtotal + shippingAmount;
    const fmt = (n: number) => `${n.toLocaleString('en-SA')} SAR`;
    const shippingBlock = resolvedAddress?.['shipping'] as
      | ResolvedAddr
      | undefined;
    return {
      cartId,
      addressComplete: addrComplete,
      contactsComplete,
      shippingComplete: !!shippingOptionId,
      shippingOptionsAvailable: opts.length > 0,
      shippingOptionId: shippingOptionId ?? null,
      selectedShipping: selected ?? null,
      shippingRecommendation: shippingPayload.recommendation,
      deliveryAddress: shippingBlock?.formatted ?? null,
      resolvedAddress,
      cartPreview: cart,
      totals: {
        currency: 'SAR',
        subtotal,
        shipping: shippingAmount,
        grandTotal,
        formattedSubtotal: fmt(subtotal),
        formattedShipping:
          selected?.price?.formatted ?? (shippingAmount > 0 ? fmt(shippingAmount) : fmt(0)),
        formattedGrandTotal: fmt(grandTotal),
        itemCount: cart.totals?.itemCount ?? cart.items?.length ?? 0,
      },
    };
  }

  async shippingOptions(
    cartId: string,
    userId: string,
  ): Promise<ShippingOptionsPayload> {
    this.ensureOwnership(cartId, userId);
    const [baseOptions, cart, snapshot] = await Promise.all([
      this.odooShipping.getStorefrontOptions(),
      this.cartService.getCart(cartId, userId),
      this.catalogProducts.getSnapshot(),
    ]);
    const lines = (cart.items ?? []).map((line) => ({
      id: line.id,
      productSlug: line.productSlug,
      productName: line.productName,
      packagingOptionId: line.packagingOptionId,
      packagingLabel: line.packagingLabel,
      quantity: line.quantity,
      palletType: line.palletType,
    }));
    return this.shippingEngine.build(
      baseOptions,
      lines,
      snapshot.productsBySlug,
    );
  }

  async putShipping(cartId: string, userId: string, shippingOptionId: string) {
    this.ensureOwnership(cartId, userId);
    const payload = await this.shippingOptions(cartId, userId);
    const selected = payload.options.find((o) => o.id === shippingOptionId);
    if (!selected) {
      throw new BadRequestException('Invalid shipping option');
    }
    const prev =
      this.persistence.checkoutDrafts.get(cartId) ??
      ({
        cartId,
        userId,
        payload: {},
      } satisfies CheckoutDraftEntity);
    prev.payload['shippingOptionId'] = shippingOptionId;
    this.persistence.checkoutDrafts.set(cartId, prev);
    return {
      cartId,
      shippingOptionId,
      carrierLabel: selected.label,
    };
  }

  async paymentIntent(
    cartId: string,
    userId: string,
    method: 'card' | 'cod' | 'wire',
  ) {
    this.ensureOwnership(cartId, userId);
    const cart = await this.cartService.getCart(cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(cartId);
    const shipOpt = draft?.payload['shippingOptionId'] as string | undefined;
    let shippingAmount = 0;
    if (shipOpt) {
      const opts = await this.shippingOptions(cartId, userId);
      shippingAmount = opts.options.find((o) => o.id === shipOpt)?.price?.amount ?? 0;
    }
    const amount = (cart.totals?.subtotal ?? 0) + shippingAmount;

    const resolved = draft?.payload['resolved'] as Record<string, unknown> | undefined;
    const contacts = resolved?.['contacts'] as
      | Record<string, { fullName?: string; email?: string; phone?: string }>
      | undefined;
    const delivery = contacts?.['delivery'];
    const user = this.persistence.usersById.get(userId);

    const intent = await this.payments.createIntent(cartId, userId, {
      method,
      amount,
      currency: 'SAR',
      customerEmail: delivery?.email || user?.email,
      customerPhone: delivery?.phone || user?.phone,
      customerName:
        delivery?.fullName || user?.displayName || user?.email || 'Customer',
      cartDescription: `Black Tiger order cart ${cartId}`,
    });

    const payload = draft?.payload ?? {};
    payload['paymentIntent'] = {
      ...intent,
      method,
      amount,
      currency: 'SAR',
    };
    this.persistence.checkoutDrafts.set(cartId, {
      cartId,
      userId,
      payload,
    });

    return intent;
  }

  getPaymentIntent(cartId: string, userId: string) {
    this.ensureOwnership(cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(cartId);
    const stored = draft?.payload['paymentIntent'] as
      | {
          paymentIntentId?: string;
          status?: string;
          gateway?: string;
          redirectUrl?: string | null;
          tranRef?: string | null;
          amount?: number;
          currency?: string;
          method?: string;
        }
      | undefined;
    if (!stored?.paymentIntentId) {
      throw new NotFoundException('Payment intent not found for cart');
    }
    const live = this.payments.getIntent(stored.paymentIntentId);
    const status = live?.status ?? stored.status ?? this.payments.getIntentStatus(stored.paymentIntentId);
    return {
      paymentIntentId: stored.paymentIntentId,
      status,
      gateway: live?.gateway ?? stored.gateway ?? this.payments.activeGateway(),
      redirectUrl: live?.redirectUrl ?? stored.redirectUrl ?? null,
      tranRef: live?.tranRef ?? stored.tranRef ?? null,
      amount: live?.amount ?? stored.amount,
      currency: live?.currency ?? stored.currency ?? 'SAR',
      method: live?.method ?? stored.method,
    };
  }

  async confirmPaymentIntent(
    cartId: string,
    userId: string,
    paymentIntentId: string,
  ) {
    this.ensureOwnership(cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(cartId);
    const stored = draft?.payload['paymentIntent'] as
      | { paymentIntentId?: string }
      | undefined;
    if (!stored?.paymentIntentId || stored.paymentIntentId !== paymentIntentId) {
      throw new BadRequestException('Payment intent mismatch for cart');
    }
    const result = await this.payments.confirmIntent(paymentIntentId);
    if (draft) {
      draft.payload['paymentIntent'] = {
        ...stored,
        status: result.status,
      };
      this.persistence.checkoutDrafts.set(cartId, draft);
    }
    return { paymentIntentId, status: result.status };
  }

  async submit(
    cartId: string,
    userId: string,
    paymentMethod: 'card' | 'cod' | 'wire' = 'cod',
  ) {
    this.ensureOwnership(cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(cartId);
    if (!draft?.payload['resolved']) {
      throw new BadRequestException('Checkout address incomplete');
    }
    const shipOpt = draft.payload['shippingOptionId'];
    if (!shipOpt || typeof shipOpt !== 'string') {
      throw new BadRequestException('Shipping method not selected');
    }
    const cart = await this.cartService.getCart(cartId, userId);
    const items = cart.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const paymentIntent = draft.payload['paymentIntent'] as
      | {
          method?: string;
          status?: string;
          paymentIntentId?: string;
          amount?: number;
          tranRef?: string | null;
          gateway?: string;
        }
      | undefined;
    const method = paymentMethod ?? paymentIntent?.method ?? 'cod';
    if (method === 'card') {
      const live = paymentIntent?.paymentIntentId
        ? this.payments.getIntent(paymentIntent.paymentIntentId)
        : undefined;
      const status =
        live?.status ??
        paymentIntent?.status ??
        (paymentIntent?.paymentIntentId
          ? this.payments.getIntentStatus(paymentIntent.paymentIntentId)
          : undefined);
      if (status !== 'succeeded') {
        throw new BadRequestException(
          'Card payment not confirmed. Complete PayTabs payment (or sandbox confirm) first.',
        );
      }
    }

    const opts = await this.shippingOptions(cartId, userId);
    const selected = opts.options.find((o) => o.id === shipOpt);
    const shippingAmount = selected?.price?.amount ?? 0;
    const shippingLabel = selected?.label ?? shipOpt;
    const subtotal = cart.totals?.subtotal ?? 0;
    const grandTotal = subtotal + shippingAmount;
    const fmt = (n: number) => `${n.toLocaleString('en-SA')} SAR`;

    if (method === 'card' && paymentIntent?.amount != null) {
      const expected = Math.round(grandTotal * 100) / 100;
      const paid = Math.round(Number(paymentIntent.amount) * 100) / 100;
      if (paid !== expected) {
        throw new BadRequestException(
          `Payment amount mismatch (paid ${paid}, cart total ${expected}).`,
        );
      }
    }

    const user = this.persistence.usersById.get(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resolved = draft.payload['resolved'] as Record<string, unknown>;
    const orderItems = items.map((line) => ({
      id: line.id,
      productSlug: line.productSlug,
      productName: line.productName,
      packagingOptionId: line.packagingOptionId,
      packagingLabel: line.packagingLabel,
      quantity: line.quantity,
      palletType: line.palletType,
      unitPrice: line.unitPrice ?? 0,
      totalPrice: line.totalPrice ?? 0,
    }));

    const totals = {
      currency: 'SAR' as const,
      subtotal,
      shipping: shippingAmount,
      grandTotal,
      formattedSubtotal: fmt(subtotal),
      formattedShipping: fmt(shippingAmount),
      formattedGrandTotal: fmt(grandTotal),
    };

    const paymentNote =
      method === 'card' && paymentIntent?.tranRef
        ? `PayTabs tran_ref=${paymentIntent.tranRef} gateway=${paymentIntent.gateway ?? 'paytabs'}`
        : method === 'card'
          ? `Card payment via ${paymentIntent?.gateway ?? this.payments.activeGateway()}`
          : `Payment method: ${method}`;

    if (this.odooOrders.isLive()) {
      try {
        const payload = buildStorefrontCheckoutPayload({
          cartId,
          user,
          resolved,
          cartItems: orderItems,
          shippingAmount,
          shippingLabel,
          shippingOptionId: shipOpt,
          note: paymentNote,
        });
        const odoo = await this.odooOrders.createStorefrontOrder(payload);
        const order: OrderEntity = {
          id: String(odoo.order_id),
          odooSaleOrderId: odoo.order_id,
          userId,
          orderNumber: odoo.order_number,
          status: odoo.state,
          createdAt: new Date().toISOString(),
          items: orderItems,
          totals: {
            ...totals,
            grandTotal: odoo.amount_total,
            formattedGrandTotal: odoo.formatted_total,
            currency: odoo.currency,
          },
          shippingOptionId: shipOpt,
          shippingLabel,
        };
        this.persistence.addOrder(order);
        this.cartService.deleteCart(cartId, userId);
        return {
          orderId: String(odoo.order_id),
          orderNumber: odoo.order_number,
          status: odoo.state,
          message: 'Sale order created in Odoo.',
          order,
        };
      } catch (err) {
        this.logger.error(
          `Odoo sale order creation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new ServiceUnavailableException(
          'Could not create sale order in Odoo. Please try again.',
        );
      }
    }

    const orderId = newId();
    const orderNumber = `BT-M1-${orderId.slice(0, 8).toUpperCase()}`;
    const order: OrderEntity = {
      id: orderId,
      userId,
      orderNumber,
      status: 'draft',
      createdAt: new Date().toISOString(),
      items: orderItems,
      totals,
      shippingOptionId: shipOpt,
      shippingLabel,
    };
    this.persistence.addOrder(order);
    this.cartService.deleteCart(cartId, userId);

    return {
      orderId,
      orderNumber,
      status: 'draft',
      message: 'Order recorded locally (Odoo live mode disabled).',
      order,
    };
  }

  private resolveShippingBlock(
    userId: string,
    dto: CheckoutAddressDto,
    savedIds: Record<string, string | undefined>,
  ): ResolvedAddr {
    if (dto.shippingAddressId) {
      const a = this.persistence.getUserAddresses(userId).get(dto.shippingAddressId);
      if (!a || !a.usageTypes.includes('shipping')) {
        throw new NotFoundException('Shipping address not found');
      }
      return this.addrEntity(a);
    }
    if (dto.shippingAddress) {
      const ent = dto.shippingAddress;
      const formatted = `${ent.addressLine1}, ${ent.city}, ${ent.countryCode}`;
      if (dto.saveToAddressBook) {
        const created = this.persistInlineAddress(userId, ent);
        savedIds['shippingAddressId'] = created.id;
        return this.addrEntity(created);
      }
      return {
        addressId: null,
        label: ent.label,
        companyName: ent.companyName,
        recipientName: ent.recipientName,
        formatted,
        countryCode: ent.countryCode,
        addressLine1: ent.addressLine1,
        addressLine2: ent.addressLine2,
        city: ent.city,
        stateCode: ent.stateCode,
        postalCode: ent.postalCode,
      };
    }
    throw new BadRequestException(
      'shippingAddressId or shippingAddress required',
    );
  }

  private resolveBillingBlock(
    userId: string,
    dto: CheckoutAddressDto,
    savedIds: Record<string, string | undefined>,
  ): ResolvedAddr {
    if (dto.billingAddressId) {
      const a = this.persistence.getUserAddresses(userId).get(dto.billingAddressId);
      if (!a || !a.usageTypes.includes('billing')) {
        throw new NotFoundException('Billing address not found');
      }
      return this.addrEntity(a);
    }
    if (dto.billingAddress) {
      const ent = dto.billingAddress;
      const formatted = `${ent.addressLine1}, ${ent.city}, ${ent.countryCode}`;
      if (dto.saveToAddressBook) {
        const created = this.persistInlineAddress(userId, ent);
        savedIds['billingAddressId'] = created.id;
        return this.addrEntity(created);
      }
      return {
        addressId: null,
        formatted,
        countryCode: ent.countryCode,
        addressLine1: ent.addressLine1,
        city: ent.city,
      };
    }
    throw new BadRequestException(
      'billingAddressId or billingAddress required',
    );
  }

  private addrEntity(a: AddressEntity): ResolvedAddr {
    const formatted = `${a.addressLine1}, ${a.city}, ${a.countryCode}`;
    return {
      addressId: a.id,
      label: a.label,
      companyName: a.companyName,
      recipientName: a.recipientName,
      formatted,
      countryCode: a.countryCode,
      addressLine1: a.addressLine1,
      addressLine2: a.addressLine2,
      city: a.city,
      stateCode: a.stateCode,
      postalCode: a.postalCode,
    };
  }

  private persistInlineAddress(
    userId: string,
    ent: NonNullable<CheckoutAddressDto['shippingAddress']>,
  ): AddressEntity {
    const now = new Date().toISOString();
    const addr: AddressEntity = {
      id: newId(),
      userId,
      createdAt: now,
      updatedAt: now,
      label: ent.label,
      usageTypes: ent.usageTypes,
      companyName: ent.companyName,
      recipientName: ent.recipientName,
      countryCode: ent.countryCode,
      addressLine1: ent.addressLine1,
      addressLine2: ent.addressLine2,
      city: ent.city,
      stateCode: ent.stateCode,
      postalCode: ent.postalCode,
      phone: ent.phone,
      deliveryInstructions: ent.deliveryInstructions,
      isDefaultShipping: ent.isDefaultShipping ?? false,
      isDefaultBilling: ent.isDefaultBilling ?? false,
    };
    this.persistence.getUserAddresses(userId).set(addr.id, addr);
    return addr;
  }

  private resolveContactsBlock(
    userId: string,
    dto: CheckoutAddressDto,
    savedIds: Record<string, string | undefined>,
  ): Record<string, ResolvedCt> {
    const out: Record<string, ResolvedCt> = {};

    if (dto.deliveryContactId) {
      const c = this.persistence.getUserContacts(userId).get(dto.deliveryContactId);
      if (!c) {
        throw new NotFoundException('Contact not found');
      }
      out['delivery'] = this.ctEntity(c);
    } else if (dto.deliveryContact) {
      const ent = dto.deliveryContact;
      if (dto.saveContacts) {
        const c = this.persistInlineContact(userId, ent);
        savedIds['deliveryContactId'] = c.id;
        out['delivery'] = this.ctEntity(c);
      } else {
        out['delivery'] = {
          contactId: null,
          fullName: `${ent.firstName} ${ent.lastName}`,
          email: ent.email,
          phone: ent.phone,
        };
      }
    }

    if (dto.billingContactId) {
      const c = this.persistence.getUserContacts(userId).get(dto.billingContactId);
      if (!c) {
        throw new NotFoundException('Contact not found');
      }
      out['billing'] = this.ctEntity(c);
    } else if (dto.billingContact) {
      const ent = dto.billingContact;
      if (dto.saveContacts) {
        const c = this.persistInlineContact(userId, ent);
        savedIds['billingContactId'] = c.id;
        out['billing'] = this.ctEntity(c);
      } else {
        out['billing'] = {
          contactId: null,
          fullName: `${ent.firstName} ${ent.lastName}`,
          email: ent.email,
          phone: ent.phone,
        };
      }
    }

    if (dto.orderNotificationContactId) {
      const c = this.persistence
        .getUserContacts(userId)
        .get(dto.orderNotificationContactId);
      if (!c) {
        throw new NotFoundException('Contact not found');
      }
      out['orderNotifications'] = this.ctEntity(c);
    }

    return out;
  }

  private ctEntity(c: ContactEntity): ResolvedCt {
    return {
      contactId: c.id,
      fullName: `${c.firstName} ${c.lastName}`,
      email: c.email,
      phone: c.phone,
    };
  }

  private persistInlineContact(
    userId: string,
    ent: NonNullable<CheckoutAddressDto['deliveryContact']>,
  ): ContactEntity {
    const now = new Date().toISOString();
    const row: ContactEntity = {
      id: newId(),
      userId,
      createdAt: now,
      updatedAt: now,
      label: ent.label,
      usageTypes: ent.usageTypes,
      firstName: ent.firstName,
      lastName: ent.lastName,
      email: ent.email,
      phone: ent.phone,
      mobile: ent.mobile,
      jobTitle: ent.jobTitle,
      department: undefined,
      companyName: undefined,
      isDefaultDelivery: ent.isDefaultDelivery ?? false,
      isDefaultOrderNotifications: ent.isDefaultOrderNotifications ?? false,
      isDefaultBilling: ent.isDefaultBilling ?? false,
    };
    this.persistence.getUserContacts(userId).set(row.id, row);
    return row;
  }
}
