import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { newId } from '../../common/utils/uuid';
import type { ContactInquiryEntity } from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';
import type { CreateContactInquiryDto } from './contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly config: ConfigService,
  ) {}

  create(dto: CreateContactInquiryDto) {
    const now = new Date().toISOString();
    const row: ContactInquiryEntity = {
      id: newId(),
      ...dto,
      status: 'received',
      createdAt: now,
    };
    this.persistence.contactInquiries.push(row);
    this.logger.log(
      `Contact inquiry ${row.id} from ${row.email} (${row.company})`,
    );

    if (this.config.get<string>('ODOO_MODE') === 'live') {
      this.logger.debug(
        'ODOO_MODE=live — CRM lead hook reserved for post-M3 adapter',
      );
    }

    return {
      inquiryId: row.id,
      status: row.status,
      message: 'Thank you. Your inquiry has been received.',
    };
  }
}
