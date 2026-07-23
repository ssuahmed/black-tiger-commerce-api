import { Injectable, Logger } from '@nestjs/common';
import { CatalogCacheService } from '../../infrastructure/cache/catalog-cache.service';
import { ContentCacheService } from '../../infrastructure/cache/content-cache.service';
import { OdooShippingService } from '../../infrastructure/odoo/odoo-shipping.service';

export type OdooWebhookPayload = {
  model: string;
  ids?: number[];
  action?: string;
  slug?: string | false;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly catalogCache: CatalogCacheService,
    private readonly contentCache: ContentCacheService,
    private readonly shipping: OdooShippingService,
  ) {}

  async handleOdooEvent(payload: OdooWebhookPayload): Promise<{ invalidated: string[] }> {
    const model = payload.model || '';
    const invalidated: string[] = [];

    if (
      model === 'product.template' ||
      model === 'product.product' ||
      model === 'product.category' ||
      model === 'product.pricelist' ||
      model === 'product.pricelist.item'
    ) {
      await this.catalogCache.invalidateAll();
      invalidated.push('catalog');
    }

    if (model === 'bt.website.page' || model === 'bt.website.section') {
      const slug = typeof payload.slug === 'string' ? payload.slug : undefined;
      if (slug) {
        await this.contentCache.invalidatePage(slug);
        invalidated.push(`content:${slug}`);
      } else {
        await this.contentCache.invalidateAll();
        invalidated.push('content:*');
      }
    }

    if (
      model.includes('shipping') ||
      model === 'bt.storefront.shipping.option' ||
      model === 'delivery.carrier'
    ) {
      await this.shipping.invalidateCache();
      invalidated.push('shipping');
    }

    this.logger.log(
      `Webhook ${model}/${payload.action ?? 'event'} → invalidate [${invalidated.join(', ') || 'none'}]`,
    );

    return { invalidated };
  }
}
