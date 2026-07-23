import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  FEATURED_SLUGS,
  MOCK_CATEGORY_TREE,
  PRODUCTS_BY_SLUG,
  type ProductFixture,
} from '../../mocks/catalog.fixtures';
import {
  OdooCatalogLoader,
  type CatalogCategoryDetail,
  type CatalogCategoryTree,
  type OdooCatalogSnapshot,
} from '../../infrastructure/odoo/odoo-catalog.loader';
import { buildMockCategoriesBySlug } from '../../mocks/catalog-categories.mock';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { CatalogCacheService } from '../../infrastructure/cache/catalog-cache.service';

@Injectable()
export class CatalogProductsProvider {
  private readonly logger = new Logger(CatalogProductsProvider.name);
  /** Single-flight cold load so concurrent PLP requests share one Odoo fetch. */
  private loadInFlight: Promise<OdooCatalogSnapshot> | null = null;

  constructor(
    private readonly odoo: OdooClient,
    private readonly loader: OdooCatalogLoader,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  async invalidateCache(): Promise<void> {
    await this.catalogCache.invalidateAll();
  }

  async getSnapshot(): Promise<{
    productsBySlug: Record<string, ProductFixture>;
    categoryTree: CatalogCategoryTree;
    categoriesBySlug: Record<string, CatalogCategoryDetail>;
    featuredSlugs: string[];
    source: 'odoo' | 'mock';
  }> {
    if (!this.isLive()) {
      return {
        productsBySlug: PRODUCTS_BY_SLUG,
        categoryTree: MOCK_CATEGORY_TREE,
        categoriesBySlug: buildMockCategoriesBySlug(),
        featuredSlugs: FEATURED_SLUGS,
        source: 'mock',
      };
    }

    try {
      let snapshot = await this.catalogCache.getSnapshot();
      if (!snapshot) {
        snapshot = await this.loadAndCache();
      }
      return {
        productsBySlug: snapshot.productsBySlug,
        categoryTree: snapshot.categoryTree,
        categoriesBySlug: snapshot.categoriesBySlug,
        featuredSlugs: snapshot.featuredSlugs,
        source: 'odoo',
      };
    } catch (err) {
      const message = `Odoo catalog load failed: ${String(err)}`;
      if (this.isLive()) {
        this.logger.error(message);
        throw new ServiceUnavailableException(
          'Catalog unavailable — Odoo live load failed',
        );
      }
      this.logger.warn(`${message}, using mock fixtures`);
      return {
        productsBySlug: PRODUCTS_BY_SLUG,
        categoryTree: MOCK_CATEGORY_TREE,
        categoriesBySlug: buildMockCategoriesBySlug(),
        featuredSlugs: FEATURED_SLUGS,
        source: 'mock',
      };
    }
  }

  private async loadAndCache(): Promise<OdooCatalogSnapshot> {
    if (!this.loadInFlight) {
      this.loadInFlight = (async () => {
        const snapshot = await this.loader.load();
        await this.catalogCache.setSnapshot(snapshot);
        return snapshot;
      })().finally(() => {
        this.loadInFlight = null;
      });
    }
    return this.loadInFlight;
  }

  async getProduct(slug: string): Promise<ProductFixture | undefined> {
    const { productsBySlug } = await this.getSnapshot();
    return productsBySlug[slug];
  }

  async getAllProducts(): Promise<ProductFixture[]> {
    const { productsBySlug } = await this.getSnapshot();
    return Object.values(productsBySlug);
  }
}
