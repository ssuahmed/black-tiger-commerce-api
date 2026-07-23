import { Module } from '@nestjs/common';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { ContentModule } from '../../modules/content/content.module';
import { OdooClient } from '../odoo/odoo.client';
import { OdooShippingService } from '../odoo/odoo-shipping.service';
import { IntegrationProbeService } from './integration-probe.service';

@Module({
  imports: [CatalogModule, ContentModule],
  providers: [OdooClient, OdooShippingService, IntegrationProbeService],
  exports: [IntegrationProbeService],
})
export class IntegrationModule {}
