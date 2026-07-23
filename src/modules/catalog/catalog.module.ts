import { Module } from '@nestjs/common';
import { OdooCatalogLoader } from '../../infrastructure/odoo/odoo-catalog.loader';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogProductsProvider } from './catalog-products.provider';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [AuthModule, WebhooksModule],
  controllers: [CatalogController],
  providers: [
    OdooClient,
    OdooCatalogLoader,
    CatalogProductsProvider,
    CatalogService,
  ],
  exports: [CatalogService, CatalogProductsProvider],
})
export class CatalogModule {}
