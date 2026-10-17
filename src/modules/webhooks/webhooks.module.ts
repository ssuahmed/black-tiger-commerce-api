/**
 * Nest module wiring Odoo → API cache invalidation webhooks.
 *
 * Storefront → API ← Odoo: when catalog/CMS/shipping records change in Odoo, signed
 * webhooks hit this module so Redis/catalog/content/shipping caches stay fresh for
 * the next storefront request.
 */
import { Module } from '@nestjs/common';
import { CatalogCacheService } from '../../infrastructure/cache/catalog-cache.service';
import { ContentCacheService } from '../../infrastructure/cache/content-cache.service';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { OdooShippingService } from '../../infrastructure/odoo/odoo-shipping.service';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [
    CatalogCacheService,
    ContentCacheService,
    OdooClient,
    OdooShippingService,
    WebhooksService,
    WebhookSignatureGuard,
  ],
  exports: [CatalogCacheService, ContentCacheService, WebhooksService],
})
export class WebhooksModule {}
