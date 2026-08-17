import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CatalogCacheService } from '../../infrastructure/cache/catalog-cache.service';
import { OdooCatalogLoader } from '../../infrastructure/odoo/odoo-catalog.loader';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { OdooMediaProxyService } from '../media/odoo-media-proxy.service';
import { CatalogProductsProvider } from './catalog-products.provider';

describe('CatalogProductsProvider', () => {
  const loader = { load: jest.fn() };
  const cache = {
    getSnapshot: jest.fn(),
    setSnapshot: jest.fn(),
    invalidateAll: jest.fn(),
  };
  const odoo = { isConfigured: jest.fn() };
  const mediaProxy = {
    rewritePublicUrl: jest.fn((url: string | null | undefined) => url),
  };

  let provider: CatalogProductsProvider;

  beforeEach(async () => {
    jest.clearAllMocks();
    mediaProxy.rewritePublicUrl.mockImplementation(
      (url: string | null | undefined) => url,
    );
    const module = await Test.createTestingModule({
      providers: [
        CatalogProductsProvider,
        { provide: OdooClient, useValue: odoo },
        { provide: OdooCatalogLoader, useValue: loader },
        { provide: CatalogCacheService, useValue: cache },
        { provide: OdooMediaProxyService, useValue: mediaProxy },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    provider = module.get(CatalogProductsProvider);
  });

  it('returns mock snapshot when ODOO_MODE is not live', async () => {
    odoo.isConfigured.mockReturnValue(false);
    const snap = await provider.getSnapshot();
    expect(snap.source).toBe('mock');
    expect(Object.keys(snap.productsBySlug).length).toBeGreaterThan(0);
  });

  it('returns odoo snapshot from cache when live', async () => {
    odoo.isConfigured.mockReturnValue(true);
    cache.getSnapshot.mockResolvedValue({
      productsBySlug: { 'tiger-x': { slug: 'tiger-x' } },
      categoryTree: { categories: [] },
      categoriesBySlug: {},
      featuredSlugs: [],
    });
    const snap = await provider.getSnapshot();
    expect(snap.source).toBe('odoo');
    expect(loader.load).not.toHaveBeenCalled();
  });

  it('rewrites stale absolute Odoo image URLs from cache', async () => {
    odoo.isConfigured.mockReturnValue(true);
    mediaProxy.rewritePublicUrl.mockImplementation((url: string | null | undefined) => {
      if (typeof url === 'string' && url.includes('/web/image/')) {
        return `http://localhost:3001/v1/media/odoo?path=${encodeURIComponent(new URL(url).pathname)}`;
      }
      return url;
    });
    cache.getSnapshot.mockResolvedValue({
      productsBySlug: {
        'tiger-x': {
          slug: 'tiger-x',
          imageUrl:
            'https://blacktigertest.odoodatabase.it.com/web/image/bt.product.image/1/image',
          gallery: [
            {
              url: 'https://blacktigertest.odoodatabase.it.com/web/image/bt.product.image/1/image',
              alt: 'x',
            },
          ],
          packagingOptions: [],
        },
      },
      categoryTree: { categories: [] },
      categoriesBySlug: {},
      featuredSlugs: [],
    });
    const snap = await provider.getSnapshot();
    expect(snap.productsBySlug['tiger-x'].imageUrl).toContain('/v1/media/odoo');
    expect(snap.productsBySlug['tiger-x'].gallery?.[0].url).toContain('/v1/media/odoo');
  });

  it('throws when live Odoo load fails (no silent mock fallback)', async () => {
    odoo.isConfigured.mockReturnValue(true);
    cache.getSnapshot.mockResolvedValue(null);
    loader.load.mockRejectedValue(new Error('RPC timeout'));
    await expect(provider.getSnapshot()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
