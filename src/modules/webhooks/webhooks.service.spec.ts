import { CatalogCacheService } from '../../infrastructure/cache/catalog-cache.service';
import { ContentCacheService } from '../../infrastructure/cache/content-cache.service';
import { OdooShippingService } from '../../infrastructure/odoo/odoo-shipping.service';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  const catalogCache = { invalidateAll: jest.fn() };
  const contentCache = {
    invalidatePage: jest.fn(),
    invalidateAll: jest.fn(),
  };
  const shipping = { invalidateCache: jest.fn() };
  let service: WebhooksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService(
      catalogCache as unknown as CatalogCacheService,
      contentCache as unknown as ContentCacheService,
      shipping as unknown as OdooShippingService,
    );
  });

  it('invalidates catalog cache for product models', async () => {
    const result = await service.handleOdooEvent({
      model: 'product.template',
      action: 'write',
      ids: [1],
    });
    expect(catalogCache.invalidateAll).toHaveBeenCalled();
    expect(result.invalidated).toContain('catalog');
  });

  it('invalidates single CMS page when slug provided', async () => {
    const result = await service.handleOdooEvent({
      model: 'bt.website.page',
      slug: 'home',
      action: 'write',
    });
    expect(contentCache.invalidatePage).toHaveBeenCalledWith('home');
    expect(result.invalidated).toContain('content:home');
  });

  it('invalidates all CMS pages when slug missing', async () => {
    const result = await service.handleOdooEvent({
      model: 'bt.website.section',
      action: 'write',
    });
    expect(contentCache.invalidateAll).toHaveBeenCalled();
    expect(result.invalidated).toContain('content:*');
  });

  it('invalidates shipping cache for shipping models', async () => {
    const result = await service.handleOdooEvent({
      model: 'delivery.carrier',
      action: 'write',
    });
    expect(shipping.invalidateCache).toHaveBeenCalled();
    expect(result.invalidated).toContain('shipping');
  });
});
