import { Module } from '@nestjs/common';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  imports: [WebhooksModule],
  controllers: [ContentController],
  providers: [ContentService, OdooClient],
  exports: [ContentService],
})
export class ContentModule {}
