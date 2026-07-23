import { Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import type { QuoteStubEntity } from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';

@Injectable()
export class QuotesService {
  constructor(private readonly persistence: PersistenceService) {}

  create(userId: string, dto: { notes?: string }) {
    const row: QuoteStubEntity = {
      id: newId(),
      userId,
      status: 'received',
      createdAt: new Date().toISOString(),
      payload: { notes: dto.notes ?? '' },
    };
    this.persistence.getUserQuotes(userId).set(row.id, row);
    return {
      quoteId: row.id,
      status: row.status,
      message: 'Quote request captured (M1 stub — pricing desk offline).',
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
      lines: [],
      payload: row.payload,
    };
  }
}
