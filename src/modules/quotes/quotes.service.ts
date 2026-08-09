import { Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import type { QuoteStubEntity } from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';
import { CartService } from '../cart/cart.service';
import { CheckoutService } from '../checkout/checkout.service';
import {
  buildQuotePdf,
  quotePdfFileName,
  type QuotePdfLine,
} from './quote-pdf';

@Injectable()
export class QuotesService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly carts: CartService,
    private readonly checkout: CheckoutService,
  ) {}

  async create(
    userId: string,
    dto: { cartId: string; notes?: string; purchaseOrderNumber?: string },
  ) {
    const cart = await this.carts.getCart(dto.cartId, userId);
    const summary = await this.checkout.getSummary(dto.cartId, userId);
    const draft = this.persistence.checkoutDrafts.get(dto.cartId);
    const resolved = (summary.resolvedAddress ??
      draft?.payload['resolved']) as Record<string, unknown> | undefined;
    const address = (resolved?.['shipping'] as Record<string, unknown> | undefined) ?? null;
    const shippingLabel =
      (summary.selectedShipping as { label?: string } | null | undefined)?.label ??
      null;
    const totals = summary.totals ?? {
      ...cart.totals,
      shipping: cart.totals?.shipping ?? 0,
    };
    const notes =
      dto.notes ??
      (typeof summary.orderNotes === 'string' ? summary.orderNotes : '');
    const purchaseOrderNumber =
      dto.purchaseOrderNumber ??
      summary.purchaseOrderNumber ??
      draft?.payload['purchaseOrderNumber'] ??
      null;

    const snapshot = {
      cartId: dto.cartId,
      notes,
      purchaseOrderNumber,
      lines: cart.items,
      totals,
      logistics: summary.logistics ?? cart.logistics,
      promo: summary.promo ?? cart.promo,
      address,
      shippingLabel,
      selectedShipping: summary.selectedShipping ?? null,
    };

    const row: QuoteStubEntity = {
      id: newId(),
      userId,
      status: 'received',
      createdAt: new Date().toISOString(),
      payload: snapshot,
    };
    this.persistence.getUserQuotes(userId).set(row.id, row);

    const pdf = this.buildPdfBuffer(row);
    const fileName = quotePdfFileName(row.id);

    return {
      quoteId: row.id,
      status: row.status,
      lines: snapshot.lines,
      totals: snapshot.totals,
      shippingLabel,
      fileName,
      pdfBase64: pdf.toString('base64'),
      message: 'Quote created. Your PDF download should start automatically.',
    };
  }

  getOne(userId: string, id: string) {
    const row = this.requireQuote(userId, id);
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      lines: row.payload['lines'] ?? [],
      totals: row.payload['totals'] ?? null,
      address: row.payload['address'] ?? null,
      shippingLabel: row.payload['shippingLabel'] ?? null,
      selectedShipping: row.payload['selectedShipping'] ?? null,
      purchaseOrderNumber: row.payload['purchaseOrderNumber'] ?? null,
      notes: row.payload['notes'] ?? '',
      logistics: row.payload['logistics'] ?? null,
      promo: row.payload['promo'] ?? null,
      payload: row.payload,
    };
  }

  getPdf(userId: string, id: string): { buffer: Buffer; fileName: string } {
    const row = this.requireQuote(userId, id);
    return {
      buffer: this.buildPdfBuffer(row),
      fileName: quotePdfFileName(row.id),
    };
  }

  private requireQuote(userId: string, id: string): QuoteStubEntity {
    const row = this.persistence.getUserQuotes(userId).get(id);
    if (!row) {
      throw new NotFoundException('Quote not found');
    }
    return row;
  }

  private buildPdfBuffer(row: QuoteStubEntity): Buffer {
    const lines = (Array.isArray(row.payload['lines'])
      ? row.payload['lines']
      : []) as QuotePdfLine[];
    const totals = (row.payload['totals'] ?? null) as
      | {
          currency?: string;
          subtotal?: number;
          discount?: number;
          vat?: number;
          shipping?: number;
          grandTotal?: number;
          formattedSubtotal?: string;
          formattedDiscount?: string;
          formattedVat?: string;
          formattedShipping?: string;
          formattedGrandTotal?: string;
        }
      | null;
    return buildQuotePdf({
      quoteId: row.id,
      createdAt: row.createdAt,
      purchaseOrderNumber:
        (row.payload['purchaseOrderNumber'] as string | null | undefined) ?? null,
      notes: (row.payload['notes'] as string | undefined) ?? '',
      lines,
      totals,
      shippingLabel:
        (row.payload['shippingLabel'] as string | null | undefined) ?? null,
      address:
        (row.payload['address'] as Record<string, unknown> | null | undefined) ??
        null,
    });
  }
}
