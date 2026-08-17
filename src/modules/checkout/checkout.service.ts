/**
 * Checkout orchestration for the storefront cart → order flow.
 *
 * Persists a per-cart draft (address, shipping, payment intent), syncs an
 * Odoo draft quotation as soon as address is set and refreshes it when
 * shipping/payment change, then confirms a sale order on submit. Card /
 * Apple Pay go through {@link PaymentService} (PayTabs or sandbox); B2B
 * company registration uses {@link OdooCustomerService}.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import { OdooCustomerService } from '../../infrastructure/odoo/odoo-customer.service';
import {
  OdooOrderService,
  type OdooSaleOrderResult,
  type StorefrontCheckoutPayload,
} from '../../infrastructure/odoo/odoo-order.service';
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
import {
  WAREHOUSES,
  WAREHOUSES_BY_SLUG,
} from '../../mocks/warehouses.fixtures';
import { buildStorefrontCheckoutPayload } from './checkout-order.mapper';
import type {
  CheckoutAddressDto,
  CheckoutShippingDto,
  CheckoutSubmitDto,
} from './checkout.dto';
import { ShippingRecommendationEngine } from './shipping-recommendation.engine';
import type { ShippingOptionsPayload } from './shipping-recommendation.types';

/** Shipping/billing address as stored on the checkout draft after resolution. */
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
}

/** Delivery / billing / notification contact on the checkout draft. */
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
    private readonly odooCustomers: OdooCustomerService,
    private readonly payments: PaymentService,
    private readonly shippingEngine: ShippingRecommendationEngine,
    private readonly catalogProducts: CatalogProductsProvider,
  ) {}

  /** Bind an anonymous cart to the authenticated user (or verify ownership). */
  ensureOwnership(cartId: string, userId: string) {
    return this.cartService.attachUserIfAnonymous(cartId, userId);
  }

  /** Pickup warehouse list for address-kind = pickup. */
  listWarehouses() {
    return { items: WAREHOUSES };
  }

  /** Single warehouse by slug. */
  getWarehouse(slug: string) {
    const warehouse = WAREHOUSES_BY_SLUG[slug];
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  /**
   * Persist shipping/billing/contacts on the draft, optionally sync B2B company
   * to Odoo, then create/refresh the draft Odoo quotation.
   */
  async putAddress(cartId: string, userId: string, dto: CheckoutAddressDto) {
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
      accountType: dto.accountType ?? 'personal',
      business: dto.business ?? null,
    };

    const previous = this.persistence.checkoutDrafts.get(cartId);
    const prevShipOpt = previous?.payload['shippingOptionId'] as
      | string
      | undefined;

    const draft: CheckoutDraftEntity = {
      cartId,
      userId,
      payload: {
        ...(previous?.payload ?? {}),
        resolved,
        shippingOptionId: prevShipOpt,
        purchaseOrderNumber:
          dto.purchaseOrderNumber ??
          previous?.payload['purchaseOrderNumber'] ??
          null,
        orderNotes: dto.orderNotes ?? previous?.payload['orderNotes'] ?? null,
      },
    };
    this.persistence.checkoutDrafts.set(cartId, draft);

    let businessCompany: Record<string, unknown> | null = null;
    if (dto.accountType === 'business') {
      const alreadySubmitted = await this.isBusinessProfileSubmitted(userId);
      if (!alreadySubmitted) {
        businessCompany = await this.syncBusinessCompanyToOdoo(
          userId,
          dto,
          shipping,
          billing,
          contacts,
        );
        if (businessCompany) {
          (resolved as Record<string, unknown>)['businessCompany'] =
            businessCompany;
          draft.payload['resolved'] = resolved;
          this.persistence.checkoutDrafts.set(cartId, draft);
        }
      } else {
        (resolved as Record<string, unknown>)['businessProfileComplete'] = true;
        draft.payload['resolved'] = resolved;
        this.persistence.checkoutDrafts.set(cartId, draft);
      }
    }

    // Draft Odoo quotation as soon as address is submitted (before shipping/payment).
    await this.ensureOdooDraftQuote({
      cartId,
      userId,
      draft,
      note: 'Quotation created at address — shipping pending',
      payment: {
        provider: 'storefront',
        status: 'pending',
        amount: undefined,
        currency: 'SAR',
      },
      failureMessage: 'Could not create quotation in Odoo. Please try again.',
    });

    return resolved;
  }

  /** True when B2B info was already submitted / verified — skip re-validation. */
  private async isBusinessProfileSubmitted(userId: string): Promise<boolean> {
    const user = this.persistence.usersById.get(userId);
    if (!user?.email) {
      return false;
    }

    if (this.odooCustomers.isLive()) {
      try {
        const profile = await this.odooCustomers.getStorefrontAccount(user.email);
        if (profile.found && profile.segment === 'b2b') {
          return (
            profile.infoVerification === 'pending' ||
            profile.infoVerification === 'verified' ||
            profile.approvalStatus === 'pending' ||
            profile.approvalStatus === 'approved'
          );
        }
        return false;
      } catch (err) {
        this.logger.warn(
          `Business profile check failed for ${user.email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return (
      user.segment === 'b2b' &&
      (user.approvalStatus === 'pending' || user.approvalStatus === 'approved')
    );
  }

  /**
   * Register/update the B2B company partner in Odoo (CR/VAT required) and
   * mark the local user as pending B2B approval.
   */
  private async syncBusinessCompanyToOdoo(
    userId: string,
    dto: CheckoutAddressDto,
    shipping: ResolvedAddr,
    billing: ResolvedAddr,
    contacts: Record<string, ResolvedCt>,
  ): Promise<Record<string, unknown> | null> {
    const user = this.persistence.usersById.get(userId);
    if (!user?.email) {
      return null;
    }
    const companyName =
      dto.business?.organizationName?.trim() ||
      dto.shippingAddress?.companyName?.trim() ||
      shipping.companyName?.trim();
    if (!companyName) {
      throw new BadRequestException(
        'Organization name is required for a business account.',
      );
    }
    if (!dto.business?.crNumber?.trim()) {
      throw new BadRequestException(
        'Certificate of Registration Number is required.',
      );
    }
    if (!dto.business?.vatNumber?.trim()) {
      throw new BadRequestException(
        'VAT Registration Certificate Number is required.',
      );
    }

    user.segment = 'b2b';
    user.approvalStatus = 'pending';

    const delivery = contacts['delivery'];
    const toOdooAddr = (addr: ResolvedAddr) => ({
      name: addr.recipientName || delivery?.fullName || companyName,
      email: delivery?.email || user.email,
      phone: delivery?.phone || user.phone,
      address_line1: addr.addressLine1,
      address_line2: addr.addressLine2,
      city: addr.city,
      postal_code: addr.postalCode,
      country_code: addr.countryCode || 'SA',
    });

    if (!this.odooCustomers.isLive()) {
      this.logger.warn(
        `Odoo not live — business company draft only for ${user.email}`,
      );
      return {
        synced: false,
        reason: 'odoo_offline',
        companyName,
        infoVerification: 'pending',
      };
    }

    try {
      const result = await this.odooCustomers.syncBusinessCompany({
        email: user.email,
        contactName:
          delivery?.fullName || user.displayName || user.email.split('@')[0],
        phone: delivery?.phone || user.phone,
        companyName,
        organizationNameAr: dto.business?.organizationNameAr,
        vatNumber: dto.business?.vatNumber,
        crNumber: dto.business?.crNumber,
        invitationCode: dto.business?.invitationCode,
        shippingAddress: toOdooAddr(shipping),
        billingAddress: toOdooAddr(billing),
      });
      if (result.partnerId) {
        user.odooPartnerId = result.partnerId;
      }
      return {
        synced: Boolean(result.partnerId),
        partnerId: result.partnerId,
        contactPartnerId: result.contactPartnerId,
        companyName,
        infoVerification: result.infoVerification || 'pending',
      };
    } catch (err) {
      this.logger.warn(
        `Odoo business company sync failed for ${user.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException(
        'Could not register the business company in Odoo. Please try again.',
      );
    }
  }

  /** Checkout summary: completeness flags, shipping pick, logistics, totals. */
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
    const discount = cart.totals?.discount ?? 0;
    const vat = cart.totals?.vat ?? 0;
    const shippingAmount = selected?.price?.amount ?? 0;
    const grandTotal = subtotal - discount + vat + shippingAmount;
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
      purchaseOrderNumber: draft?.payload['purchaseOrderNumber'] ?? null,
      orderNotes: draft?.payload['orderNotes'] ?? null,
      logistics: cart.logistics,
      promo: cart.promo,
      resolvedAddress,
      cartPreview: cart,
      totals: {
        currency: 'SAR',
        subtotal,
        discount,
        vat,
        shipping: shippingAmount,
        grandTotal,
        formattedSubtotal: fmt(subtotal),
        formattedDiscount: fmt(discount),
        formattedVat: fmt(vat),
        formattedShipping:
          selected?.price?.formatted ??
          (shippingAmount > 0 ? fmt(shippingAmount) : fmt(0)),
        formattedGrandTotal: fmt(grandTotal),
        itemCount: cart.totals?.itemCount ?? cart.items?.length ?? 0,
      },
    };
  }

  /**
   * Fleet shipping options + utilization recommendation for the cart lines
   * (catalog packaging tiers + vehicle packing engine).
   */
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

  /**
   * Select a shipping option (fleet-auto preferred when a vehicle row is picked)
   * and refresh the Odoo draft quotation with freight.
   */
  async putShipping(cartId: string, userId: string, dto: CheckoutShippingDto) {
    this.ensureOwnership(cartId, userId);
    const payload = await this.shippingOptions(cartId, userId);
    const requestedId = dto.shippingOptionId;
    const fleetAuto = payload.options.find((o) => o.isFleetTotal || o.id === 'fleet-auto');
    const vehicleMatch = payload.options.find(
      (o) => o.id === requestedId && !o.isFleetTotal,
    );
    const selected =
      payload.options.find((o) => o.id === requestedId) ??
      (vehicleMatch ? fleetAuto : undefined) ??
      fleetAuto;
    if (!selected) {
      throw new BadRequestException('Invalid shipping option');
    }
    const shippingOptionId = selected.isFleetTotal
      ? selected.id
      : (fleetAuto?.id ?? selected.id);
    const carrierLabel =
      fleetAuto?.reason?.replace(/^Optimal mix for \d+ pallet\(s\): /, '') ||
      selected.label;
    const prev =
      this.persistence.checkoutDrafts.get(cartId) ??
      ({
        cartId,
        userId,
        payload: {},
      } satisfies CheckoutDraftEntity);
    prev.payload['shippingOptionId'] = shippingOptionId;
    this.persistDraftMetadata(prev, dto);
    this.persistence.checkoutDrafts.set(cartId, prev);

    // Refresh Odoo quotation with the selected shipping method/freight.
    await this.ensureOdooDraftQuote({
      cartId,
      userId,
      draft: prev,
      note: 'Quotation updated at shipping — awaiting payment method',
      payment: {
        provider: 'storefront',
        status: 'pending',
        currency: 'SAR',
      },
      failureMessage: 'Could not update quotation in Odoo. Please try again.',
    });

    return {
      cartId,
      shippingOptionId,
      carrierLabel: selected.label === 'Calculated vehicle fleet'
        ? carrierLabel || selected.label
        : selected.label,
      odooQuote: prev.payload['odooQuote'] ?? null,
    };
  }

  /**
   * Create a payment intent after address + shipping are complete.
   * Refreshes the Odoo quote with the chosen method, then delegates to PayTabs/sandbox.
   */
  async paymentIntent(
    cartId: string,
    userId: string,
    method: 'card' | 'apple_pay' | 'cod' | 'wire',
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

    const prepared = await this.prepareCheckoutOrder(cartId, userId, draft, shipOpt);
    const amount = prepared.grandTotal;

    // Refresh Odoo quotation with the chosen payment method (quote already exists).
    if (this.odooOrders.isLive()) {
      const paymentNote =
        method === 'card' || method === 'apple_pay'
          ? `Awaiting ${method === 'apple_pay' ? 'Apple Pay' : 'card'} payment via ${this.payments.activeGateway()}`
          : `Payment method: ${method}`;
      await this.ensureOdooDraftQuote({
        cartId,
        userId,
        draft,
        note: paymentNote,
        payment: {
          provider:
            method === 'card' || method === 'apple_pay'
              ? this.payments.activeGateway()
              : 'storefront',
          method,
          status: 'pending',
          amount,
          currency: 'SAR',
        },
        failureMessage: 'Could not update quotation in Odoo. Please try again.',
        prepared,
      });
    }

    const contacts = prepared.resolved['contacts'] as
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

    const payload = draft.payload;
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

  /** Current payment-intent status for the cart draft (live gateway + draft). */
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
    const status =
      live?.status ??
      stored.status ??
      this.payments.getIntentStatus(stored.paymentIntentId);
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

  /** Confirm a sandbox/card intent (PayTabs usually confirms via webhook). */
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
    if (
      !stored?.paymentIntentId ||
      stored.paymentIntentId !== paymentIntentId
    ) {
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

  /**
   * Final checkout submit: require paid card/Apple Pay when applicable,
   * confirm Odoo sale order (or local draft when offline), clear the cart.
   */
  async submit(cartId: string, userId: string, dto: CheckoutSubmitDto) {
    this.ensureOwnership(cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(cartId);
    if (!draft?.payload['resolved']) {
      throw new BadRequestException('Checkout address incomplete');
    }
    const shipOpt = draft.payload['shippingOptionId'];
    if (!shipOpt || typeof shipOpt !== 'string') {
      throw new BadRequestException('Shipping method not selected');
    }

    this.persistDraftMetadata(draft, dto);
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
    const method = (dto.paymentMethod ??
      paymentIntent?.method ??
      'cod') as 'card' | 'apple_pay' | 'cod' | 'wire';
    if (method === 'card' || method === 'apple_pay') {
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
          method === 'apple_pay'
            ? 'Apple Pay not confirmed. Complete PayTabs payment first.'
            : 'Card payment not confirmed. Complete PayTabs payment (or sandbox confirm) first.',
        );
      }
    }

    const prepared = await this.prepareCheckoutOrder(
      cartId,
      userId,
      draft,
      shipOpt,
    );
    const {
      orderItems,
      shippingAmount,
      shippingLabel,
      subtotal,
      discount,
      vat,
      grandTotal,
    } = prepared;
    const fmt = (n: number) => `${n.toLocaleString('en-SA')} SAR`;

    if (
      (method === 'card' || method === 'apple_pay') &&
      paymentIntent?.amount != null
    ) {
      const expected = Math.round(grandTotal * 100) / 100;
      const paid = Math.round(Number(paymentIntent.amount) * 100) / 100;
      if (paid !== expected) {
        throw new BadRequestException(
          `Payment amount mismatch (paid ${paid}, cart total ${expected}).`,
        );
      }
    }

    const totals = {
      currency: 'SAR' as const,
      subtotal,
      discount,
      vat,
      shipping: shippingAmount,
      grandTotal,
      formattedSubtotal: fmt(subtotal),
      formattedDiscount: fmt(discount),
      formattedVat: fmt(vat),
      formattedShipping: fmt(shippingAmount),
      formattedGrandTotal: fmt(grandTotal),
    };

    const paymentNote =
      method === 'card' || method === 'apple_pay'
        ? paymentIntent?.tranRef
          ? `PayTabs${method === 'apple_pay' ? ' Apple Pay' : ''} tran_ref=${paymentIntent.tranRef} gateway=${paymentIntent.gateway ?? 'paytabs'}`
          : `${method === 'apple_pay' ? 'Apple Pay' : 'Card'} payment via ${paymentIntent?.gateway ?? this.payments.activeGateway()}`
        : `Payment method: ${method}`;
    const purchaseOrderNumber =
      (draft.payload['purchaseOrderNumber'] as string | undefined) ?? null;
    const orderNotes =
      (draft.payload['orderNotes'] as string | undefined) ?? null;
    const checkoutNote = this.buildCheckoutNote(draft, paymentNote);

    if (this.odooOrders.isLive()) {
      try {
        const paymentPayload: StorefrontCheckoutPayload['payment'] =
          method === 'card' || method === 'apple_pay'
            ? {
                provider: String(paymentIntent?.gateway || 'paytabs'),
                method,
                status: 'succeeded',
                tran_ref: paymentIntent?.tranRef
                  ? String(paymentIntent.tranRef)
                  : undefined,
                amount: grandTotal,
                currency: 'SAR',
              }
            : {
                provider: 'storefront',
                method,
                status:
                  method === 'cod' || method === 'wire' ? 'pending' : 'succeeded',
                amount: grandTotal,
                currency: 'SAR',
              };
        const odoo = await this.syncOdooStorefrontOrder({
          cartId,
          userId,
          draft,
          prepared,
          note: checkoutNote,
          payment: paymentPayload,
          failureMessage:
            'Could not confirm sale order in Odoo. Please try again.',
        });
        if (odoo.payment && odoo.payment.recorded === false) {
          this.logger.warn(
            `Odoo order ${odoo.order_number} updated but PayTabs payment not recorded: ${
              odoo.payment.reason || 'unknown'
            }`,
          );
        } else if (odoo.payment?.recorded) {
          this.logger.log(
            `Odoo payment recorded for ${odoo.order_number} payment_id=${odoo.payment.payment_id ?? 'n/a'} tran_ref=${odoo.payment.tran_ref ?? 'n/a'}`,
          );
        }
        const order: OrderEntity = {
          id: String(odoo.order_id),
          odooSaleOrderId: odoo.order_id,
          userId,
          orderNumber: odoo.order_number,
          status: odoo.state,
          createdAt: new Date().toISOString(),
          purchaseOrderNumber,
          orderNotes,
          items: orderItems,
          totals: {
            ...totals,
            grandTotal: odoo.amount_total,
            formattedGrandTotal: odoo.formatted_total,
            currency: odoo.currency,
          },
          shippingOptionId: shipOpt,
          shippingLabel,
          paymentMethod: method,
          paymentProvider:
            method === 'card' || method === 'apple_pay' ? 'paytabs' : 'storefront',
          paymentStatus: String(paymentPayload.status || 'pending'),
          paytabsTranRef: paymentPayload.tran_ref
            ? String(paymentPayload.tran_ref)
            : null,
        };
        this.persistence.addOrder(order);
        this.cartService.deleteCart(cartId, userId);
        const confirmed =
          method === 'card' || method === 'apple_pay'
            ? odoo.state === 'sale' || odoo.state === 'done'
            : false;
        return {
          orderId: String(odoo.order_id),
          orderNumber: odoo.order_number,
          status: odoo.state,
          message: confirmed
            ? 'Quotation confirmed to sale order in Odoo.'
            : 'Sale order recorded in Odoo.',
          payment: odoo.payment ?? null,
          order,
        };
      } catch (err) {
        if (err instanceof ServiceUnavailableException) {
          throw err;
        }
        this.logger.error(
          `Odoo sale order confirm failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new ServiceUnavailableException(
          'Could not confirm sale order in Odoo. Please try again.',
        );
      }
    }

    const orderId = newId();
    const orderNumber = `BT-M1-${orderId.slice(0, 8).toUpperCase()}`;
    const localPaymentStatus =
      method === 'cod' || method === 'wire'
        ? 'pending'
        : method === 'card' || method === 'apple_pay'
          ? 'succeeded'
          : 'pending';
    const order: OrderEntity = {
      id: orderId,
      userId,
      orderNumber,
      status: 'draft',
      createdAt: new Date().toISOString(),
      purchaseOrderNumber,
      orderNotes,
      items: orderItems,
      totals,
      shippingOptionId: shipOpt,
      shippingLabel,
      paymentMethod: method,
      paymentProvider:
        method === 'card' || method === 'apple_pay' ? 'paytabs' : 'storefront',
      paymentStatus: localPaymentStatus,
      paytabsTranRef: paymentIntent?.tranRef
        ? String(paymentIntent.tranRef)
        : null,
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

  private buildCheckoutNote(
    draft: CheckoutDraftEntity,
    paymentNote: string,
  ): string {
    const purchaseOrderNumber =
      (draft.payload['purchaseOrderNumber'] as string | undefined) ?? null;
    const orderNotes =
      (draft.payload['orderNotes'] as string | undefined) ?? null;
    return [paymentNote, purchaseOrderNumber ? `PO: ${purchaseOrderNumber}` : null, orderNotes]
      .filter(Boolean)
      .join('\n');
  }

  /** Resolve cart lines, shipping amount, and totals for quote/order sync. */
  private async prepareCheckoutOrder(
    cartId: string,
    userId: string,
    draft: CheckoutDraftEntity,
    shipOpt: string,
  ) {
    const cart = await this.cartService.getCart(cartId, userId);
    const items = cart.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const opts = await this.shippingOptions(cartId, userId);
    const selected = opts.options.find((o) => o.id === shipOpt);
    const shippingAmount = selected?.price?.amount ?? 0;
    const shippingLabel = selected?.label ?? shipOpt;
    const subtotal = cart.totals?.subtotal ?? 0;
    const discount = cart.totals?.discount ?? 0;
    const vat = cart.totals?.vat ?? 0;
    const grandTotal = subtotal - discount + vat + shippingAmount;
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

    return {
      orderItems,
      shippingAmount,
      shippingLabel,
      shippingOptionId: shipOpt,
      subtotal,
      discount,
      vat,
      grandTotal,
      resolved,
    };
  }

  /**
   * Create or refresh the draft Odoo quotation for this cart.
   * Created at address submit; refreshed when shipping/payment method change.
   */
  private async ensureOdooDraftQuote(input: {
    cartId: string;
    userId: string;
    draft: CheckoutDraftEntity;
    note: string;
    payment?: StorefrontCheckoutPayload['payment'];
    failureMessage: string;
    prepared?: Awaited<ReturnType<CheckoutService['prepareCheckoutOrder']>>;
  }): Promise<OdooSaleOrderResult | null> {
    if (!this.odooOrders.isLive()) {
      return null;
    }
    if (!input.draft.payload['resolved']) {
      return null;
    }
    const shipOpt =
      (typeof input.draft.payload['shippingOptionId'] === 'string' &&
        input.draft.payload['shippingOptionId']) ||
      '';
    try {
      const prepared =
        input.prepared ??
        (await this.prepareCheckoutOrder(
          input.cartId,
          input.userId,
          input.draft,
          shipOpt,
        ));
      const payment = input.payment
        ? {
            ...input.payment,
            amount:
              input.payment.amount != null
                ? input.payment.amount
                : prepared.grandTotal,
          }
        : {
            provider: 'storefront',
            status: 'pending',
            amount: prepared.grandTotal,
            currency: 'SAR',
          };
      return await this.syncOdooStorefrontOrder({
        cartId: input.cartId,
        userId: input.userId,
        draft: input.draft,
        prepared,
        note: this.buildCheckoutNote(input.draft, input.note),
        payment,
        failureMessage: input.failureMessage,
      });
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      if (err instanceof BadRequestException) {
        // Empty cart / incomplete checkout — skip quote sync.
        this.logger.warn(
          `Skipping Odoo quote sync: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
      this.logger.error(
        `Odoo quotation sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(input.failureMessage);
    }
  }

  /** Map draft → Odoo storefront payload and upsert the sale order / quotation. */
  private async syncOdooStorefrontOrder(input: {
    cartId: string;
    userId: string;
    draft: CheckoutDraftEntity;
    prepared: Awaited<ReturnType<CheckoutService['prepareCheckoutOrder']>>;
    note: string;
    payment?: StorefrontCheckoutPayload['payment'];
    failureMessage: string;
  }): Promise<OdooSaleOrderResult> {
    const user = this.persistence.usersById.get(input.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const payload = buildStorefrontCheckoutPayload({
      cartId: input.cartId,
      user,
      resolved: input.prepared.resolved,
      cartItems: input.prepared.orderItems,
      shippingAmount: input.prepared.shippingAmount,
      shippingLabel: input.prepared.shippingLabel,
      shippingOptionId: input.prepared.shippingOptionId,
      note: input.note,
      payment: input.payment,
    });
    try {
      const odoo = await this.odooOrders.createStorefrontOrder(payload);
      input.draft.payload['odooQuote'] = {
        orderId: odoo.order_id,
        orderNumber: odoo.order_number,
        state: odoo.state,
        updatedAt: new Date().toISOString(),
      };
      this.persistence.checkoutDrafts.set(input.cartId, input.draft);
      this.logger.log(
        `Odoo storefront order ${odoo.order_number} state=${odoo.state} cart=${input.cartId}`,
      );
      return odoo;
    } catch (err) {
      this.logger.error(
        `Odoo storefront order sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(input.failureMessage);
    }
  }

  private persistDraftMetadata(
    draft: CheckoutDraftEntity,
    dto: { purchaseOrderNumber?: string; orderNotes?: string },
  ) {
    if (dto.purchaseOrderNumber !== undefined) {
      draft.payload['purchaseOrderNumber'] = dto.purchaseOrderNumber;
    }
    if (dto.orderNotes !== undefined) {
      draft.payload['orderNotes'] = dto.orderNotes;
    }
  }

  /** Resolve shipping from address book id or inline payload (optional save). */
  private resolveShippingBlock(
    userId: string,
    dto: CheckoutAddressDto,
    savedIds: Record<string, string | undefined>,
  ): ResolvedAddr {
    if (dto.shippingAddressId) {
      const a = this.persistence
        .getUserAddresses(userId)
        .get(dto.shippingAddressId);
      if (!a || !a.usageTypes.includes('shipping')) {
        throw new NotFoundException('Shipping address not found');
      }
      return this.addrEntity(a);
    }
    if (dto.shippingAddress) {
      const ent = dto.shippingAddress;
      const formatted =
        ent.formattedAddress ??
        `${ent.addressLine1}, ${ent.city}, ${ent.countryCode}`;
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
        ...this.extendedAddress(ent),
      };
    }
    throw new BadRequestException(
      'shippingAddressId or shippingAddress required',
    );
  }

  /** Resolve billing address (or copy of shipping when same-as-shipping). */
  private resolveBillingBlock(
    userId: string,
    dto: CheckoutAddressDto,
    savedIds: Record<string, string | undefined>,
  ): ResolvedAddr {
    if (dto.billingAddressId) {
      const a = this.persistence
        .getUserAddresses(userId)
        .get(dto.billingAddressId);
      if (!a || !a.usageTypes.includes('billing')) {
        throw new NotFoundException('Billing address not found');
      }
      return this.addrEntity(a);
    }
    if (dto.billingAddress) {
      const ent = dto.billingAddress;
      const formatted =
        ent.formattedAddress ??
        `${ent.addressLine1}, ${ent.city}, ${ent.countryCode}`;
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
        ...this.extendedAddress(ent),
      };
    }
    throw new BadRequestException(
      'billingAddressId or billingAddress required',
    );
  }

  private addrEntity(a: AddressEntity): ResolvedAddr {
    const formatted =
      a.formattedAddress ?? `${a.addressLine1}, ${a.city}, ${a.countryCode}`;
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
      ...this.extendedAddress(a),
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
      ...this.extendedAddress(ent),
      isDefaultShipping: ent.isDefaultShipping ?? false,
      isDefaultBilling: ent.isDefaultBilling ?? false,
    };
    this.persistence.getUserAddresses(userId).set(addr.id, addr);
    return addr;
  }

  private extendedAddress(
    address: Pick<
      AddressEntity,
      | 'buildingNo'
      | 'street'
      | 'secondary'
      | 'district'
      | 'landmark'
      | 'latitude'
      | 'longitude'
      | 'placeId'
      | 'formattedAddress'
      | 'addressKind'
      | 'warehouseSlug'
      | 'portOfDestination'
      | 'freightType'
      | 'nationalAddress'
      | 'companyFloor'
    >,
  ) {
    return {
      buildingNo: address.buildingNo,
      street: address.street,
      secondary: address.secondary,
      district: address.district,
      landmark: address.landmark,
      latitude: address.latitude,
      longitude: address.longitude,
      placeId: address.placeId,
      formattedAddress: address.formattedAddress,
      addressKind: address.addressKind,
      warehouseSlug: address.warehouseSlug,
      portOfDestination: address.portOfDestination,
      freightType: address.freightType,
      nationalAddress: address.nationalAddress,
      companyFloor: address.companyFloor,
    };
  }

  /** Resolve delivery / billing / notification contacts from book or inline. */
  private resolveContactsBlock(
    userId: string,
    dto: CheckoutAddressDto,
    savedIds: Record<string, string | undefined>,
  ): Record<string, ResolvedCt> {
    const out: Record<string, ResolvedCt> = {};

    if (dto.deliveryContactId) {
      const c = this.persistence
        .getUserContacts(userId)
        .get(dto.deliveryContactId);
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
      const c = this.persistence
        .getUserContacts(userId)
        .get(dto.billingContactId);
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
