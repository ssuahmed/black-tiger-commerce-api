/**
 * Storefront shopping cart: create/merge, line CRUD, promo evaluation,
 * logistics (pallet) summary, and SAR totals with 15% VAT.
 *
 * Prices come from the catalog snapshot (Odoo packaging tiers when live);
 * cart state lives in {@link PersistenceService} (in-memory for the session).
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import {
  PersistenceService,
  type CartEntity,
  type CartLineEntity,
} from '../../persistence/persistence.service';
import { CatalogProductsProvider } from '../catalog/catalog-products.provider';
import { resolveQuoteUnitPrice } from '../catalog/catalog-pricing';
import { PromotionsService } from '../promotions/promotions.service';
import { CartLogisticsService } from './cart-logistics.service';

@Injectable()
export class CartService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly catalog: CatalogProductsProvider,
    private readonly logisticsService: CartLogisticsService,
    private readonly promotions: PromotionsService,
  ) {}

  /** Create a cart, or reclaim `mergeCartId` when anonymous/owned by the user. */
  async createCart(userId: string | undefined, mergeCartId?: string) {
    if (mergeCartId) {
      const existing = this.persistence.carts.get(mergeCartId);
      if (existing && (!existing.userId || existing.userId === userId)) {
        if (userId) {
          existing.userId = userId;
        }
        existing.updatedAt = new Date().toISOString();
        return this.present(existing);
      }
    }
    const cart: CartEntity = {
      id: newId(),
      userId,
      items: [],
      updatedAt: new Date().toISOString(),
    };
    this.persistence.carts.set(cart.id, cart);
    return this.present(cart);
  }

  /** Full cart presentation (lines, logistics, promo, totals). */
  async getCart(cartId: string, userId: string | undefined) {
    const cart = this.requireCart(cartId);
    this.assertAccess(cart, userId);
    return this.present(cart);
  }

  /** Add or merge a line (same product + packaging + pallet type). */
  async addItem(
    cartId: string,
    dto: {
      productSlug: string;
      packagingOptionId: string;
      quantity: number;
      palletType: 'unit' | 'partial' | 'full';
    },
    userId: string | undefined,
  ) {
    const cart = this.requireCart(cartId);
    this.assertAccess(cart, userId);
    const product = await this.catalog.getProduct(dto.productSlug);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const pkg = product.packagingOptions.find(
      (p) => p.id === dto.packagingOptionId,
    );
    if (!pkg) {
      throw new NotFoundException('Packaging option not found');
    }
    const existing = cart.items.find(
      (l) =>
        l.productSlug === dto.productSlug &&
        l.packagingOptionId === dto.packagingOptionId &&
        l.palletType === dto.palletType,
    );
    let line: CartLineEntity;
    if (existing) {
      existing.quantity += dto.quantity;
      line = existing;
    } else {
      line = {
        id: newId(),
        productSlug: dto.productSlug,
        packagingOptionId: dto.packagingOptionId,
        quantity: dto.quantity,
        palletType: dto.palletType,
      };
      cart.items.push(line);
    }
    cart.updatedAt = new Date().toISOString();
    return this.presentLine(cart, line);
  }

  /** Update quantity / packaging / pallet type on a cart line. */
  async patchItem(
    cartId: string,
    lineId: string,
    dto: {
      packagingOptionId?: string;
      quantity?: number;
      palletType?: 'unit' | 'partial' | 'full';
    },
    userId: string | undefined,
  ) {
    const cart = this.requireCart(cartId);
    this.assertAccess(cart, userId);
    const line = cart.items.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException('Line not found');
    }
    if (dto.quantity !== undefined) {
      line.quantity = dto.quantity;
    }
    if (dto.packagingOptionId !== undefined) {
      line.packagingOptionId = dto.packagingOptionId;
    }
    if (dto.palletType !== undefined) {
      line.palletType = dto.palletType;
    }
    cart.updatedAt = new Date().toISOString();
    return this.presentLine(cart, line);
  }

  /** Remove a line and return the updated cart. */
  async removeItem(cartId: string, lineId: string, userId: string | undefined) {
    const cart = this.requireCart(cartId);
    this.assertAccess(cart, userId);
    const idx = cart.items.findIndex((l) => l.id === lineId);
    if (idx < 0) {
      throw new NotFoundException('Line not found');
    }
    cart.items.splice(idx, 1);
    cart.updatedAt = new Date().toISOString();
    return this.present(cart);
  }

  /** Delete cart and any associated checkout draft (post-order cleanup). */
  deleteCart(cartId: string, userId: string | undefined) {
    const cart = this.persistence.carts.get(cartId);
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    this.assertAccess(cart, userId);
    this.persistence.carts.delete(cartId);
    this.persistence.checkoutDrafts.delete(cartId);
  }

  /** Load cart entity or 404. */
  requireCart(id: string): CartEntity {
    const cart = this.persistence.carts.get(id);
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    return cart;
  }

  /** Claim an anonymous cart for the authenticated user at checkout start. */
  attachUserIfAnonymous(cartId: string, userId: string): CartEntity {
    const cart = this.requireCart(cartId);
    if (cart.userId && cart.userId !== userId) {
      throw new ForbiddenException('Cart belongs to another account');
    }
    cart.userId = userId;
    cart.updatedAt = new Date().toISOString();
    return cart;
  }

  private assertAccess(cart: CartEntity, userId: string | undefined) {
    if (cart.userId && userId && cart.userId !== userId) {
      throw new ForbiddenException('Cart belongs to another account');
    }
  }

  /** Enrich lines from catalog, apply promo, compute logistics + VAT totals. */
  private async present(cart: CartEntity) {
    const [lines, snapshot] = await Promise.all([
      Promise.all(cart.items.map((l) => this.linePayload(cart, l))),
      this.catalog.getSnapshot(),
    ]);
    const subtotal = lines.reduce((s, l) => s + (l.totalPrice ?? 0), 0);
    const itemCount = lines.reduce((s, l) => s + (l.quantity ?? 0), 0);
    const promo = this.promotions.evaluate(cart, subtotal);
    const discount = promo?.discount ?? 0;
    const vat = Math.round((subtotal - discount) * 0.15 * 100) / 100;
    const shipping = 0;
    const grandTotal = subtotal - discount + vat + shipping;
    const fmt = (amount: number) => `${amount.toLocaleString('en-SA')} SAR`;
    const logistics = this.logisticsService.calculate(
      cart.items,
      snapshot.productsBySlug,
    );
    return {
      id: cart.id,
      userId: cart.userId ?? null,
      updatedAt: cart.updatedAt,
      items: lines,
      logistics,
      promo,
      totals: {
        currency: 'SAR',
        subtotal,
        discount,
        vat,
        shipping,
        grandTotal,
        formattedSubtotal: fmt(subtotal),
        formattedDiscount: fmt(discount),
        formattedVat: fmt(vat),
        formattedShipping: fmt(shipping),
        formattedGrandTotal: fmt(grandTotal),
        itemCount,
      },
    };
  }

  private async presentLine(cart: CartEntity, line: CartLineEntity) {
    return this.linePayload(cart, line);
  }

  private async linePayload(_cart: CartEntity, line: CartLineEntity) {
    const product = await this.catalog.getProduct(line.productSlug);
    const pkg = product?.packagingOptions.find(
      (p) => p.id === line.packagingOptionId,
    );
    const unit = product
      ? resolveQuoteUnitPrice(
          product,
          line.palletType,
          line.quantity,
          line.packagingOptionId,
        )
      : 0;
    const totalPrice = unit * line.quantity;
    return {
      id: line.id,
      productSlug: line.productSlug,
      productName: product?.name,
      imageUrl: product?.imageUrl,
      packagingOptionId: line.packagingOptionId,
      packagingLabel: pkg?.label,
      quantity: line.quantity,
      palletType: line.palletType,
      unitPrice: unit,
      currency: 'SAR',
      totalPrice,
      formattedUnitPrice: `${unit.toLocaleString('en-SA')} SAR`,
      formattedTotalPrice: `${totalPrice.toLocaleString('en-SA')} SAR`,
    };
  }
}
