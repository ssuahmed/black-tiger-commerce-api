import { Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import type { QuoteStubEntity } from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';
import { CartService } from '../cart/cart.service';

@Injectable()
export class QuotesService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly carts: CartService,
  ) {}

  async create(
    userId: string,
    dto: { cartId: string; notes?: string; purchaseOrderNumber?: string },
  ) {
    const cart = await this.carts.getCart(dto.cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(dto.cartId);
    const resolved = draft?.payload['resolved'] as
      | Record<string, unknown>
      | undefined;
    const address = resolved?.['shipping'] ?? null;
    const snapshot = {
      cartId: dto.cartId,
      notes: dto.notes ?? '',
      purchaseOrderNumber:
        dto.purchaseOrderNumber ??
        draft?.payload['purchaseOrderNumber'] ??
        null,
      lines: cart.items,
      totals: cart.totals,
      logistics: cart.logistics,
      promo: cart.promo,
      address,
    };
    const row: QuoteStubEntity = {
      id: newId(),
      userId,
      status: 'received',
      createdAt: new Date().toISOString(),
      payload: snapshot,
    };
    this.persistence.getUserQuotes(userId).set(row.id, row);
    return {
      quoteId: row.id,
      status: row.status,
      lines: snapshot.lines,
      totals: snapshot.totals,
      message: 'Quote request captured for pricing review.',
    };
  }

  getOne(userId: string, id: string) {
    const row = this.persistence.getUserQuotes(userId).get(id);
    if (!row) {
      throw new NotFoundException('Quote not found');
    }
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      lines: row.payload['lines'] ?? [],
      totals: row.payload['totals'] ?? null,
      address: row.payload['address'] ?? null,
      purchaseOrderNumber: row.payload['purchaseOrderNumber'] ?? null,
      notes: row.payload['notes'] ?? '',
      logistics: row.payload['logistics'] ?? null,
      promo: row.payload['promo'] ?? null,
      payload: row.payload,
    };
  }
}
