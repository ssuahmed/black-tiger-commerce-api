/**
 * Catalog snapshot gateway for the storefront.
 *
 * When Odoo is configured: load products/categories via {@link OdooCatalogLoader},
 * cache the snapshot in Redis ({@link CatalogCacheService}), and rewrite media
 * URLs through the Commerce API proxy so browsers never hit Odoo image hosts.
 * Cold loads are single-flight so concurrent PLP requests share one Odoo fetch.
 * When Odoo is offline: serve mock fixtures.
 */
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
import { OdooMediaProxyService } from '../media/odoo-media-proxy.service';

@Injectable()
export class CatalogProductsProvider {
  private readonly logger = new Logger(CatalogProductsProvider.name);
  /** Single-flight cold load so concurrent PLP requests share one Odoo fetch. */
  private loadInFlight: Promise<OdooCatalogSnapshot> | null = null;

  constructor(
    private readonly odoo: OdooClient,
    private readonly loader: OdooCatalogLoader,
    private readonly catalogCache: CatalogCacheService,
    private readonly mediaProxy: OdooMediaProxyService,
  ) {}

  /** True when Odoo credentials are configured (live catalog path). */
  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  /** Drop Redis catalog snapshot (e.g. after webhook invalidation). */
  async invalidateCache(): Promise<void> {
    await this.catalogCache.invalidateAll();
  }

  /**
   * Return the full catalog snapshot: products, category tree, featured slugs,
   * and which source (odoo | mock) produced it.
   */
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
      const rewritten = this.rewriteSnapshotMedia(snapshot);
      return {
        productsBySlug: rewritten.productsBySlug,
        categoryTree: rewritten.categoryTree,
        categoriesBySlug: rewritten.categoriesBySlug,
        featuredSlugs: rewritten.featuredSlugs,
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

  /** Load from Odoo once, write Redis, coalesce concurrent callers. */
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

  /** Heal stale cached absolute Odoo /web/image URLs into API proxy links. */
  private rewriteSnapshotMedia(snapshot: OdooCatalogSnapshot): OdooCatalogSnapshot {
    const rewrite = (url: string | undefined | null) =>
      this.mediaProxy.rewritePublicUrl(url) ?? url ?? '';

    const productsBySlug: Record<string, ProductFixture> = {};
    for (const [slug, product] of Object.entries(snapshot.productsBySlug)) {
      productsBySlug[slug] = {
        ...product,
        imageUrl: rewrite(product.imageUrl) || product.imageUrl,
        gallery: product.gallery?.map((item) => ({
          ...item,
          url: rewrite(item.url) || item.url,
        })),
        documents: product.documents?.map((doc) => ({
          ...doc,
          url: rewrite(doc.url) || doc.url,
        })),
        packagingOptions: product.packagingOptions?.map((pkg) => ({
          ...pkg,
          image: pkg.image
            ? { ...pkg.image, url: rewrite(pkg.image.url) || pkg.image.url }
            : pkg.image,
          media: pkg.media?.map((item) => ({
            ...item,
            url: rewrite(item.url) || item.url,
          })),
        })),
      };
    }

    const categoriesBySlug: Record<string, CatalogCategoryDetail> = {};
    for (const [slug, cat] of Object.entries(snapshot.categoriesBySlug)) {
      const banner = cat.banner;
      categoriesBySlug[slug] = {
        ...cat,
        banner: banner?.image
          ? {
              ...banner,
              image: {
                ...banner.image,
                url: rewrite(banner.image.url) || banner.image.url,
              },
            }
          : banner,
      };
    }

    return {
      ...snapshot,
      productsBySlug,
      categoriesBySlug,
    };
  }

  /** Single product from the current snapshot, if present. */
  async getProduct(slug: string): Promise<ProductFixture | undefined> {
    const { productsBySlug } = await this.getSnapshot();
    return productsBySlug[slug];
  }

  /** All products from the current snapshot (search / bulk helpers). */
  async getAllProducts(): Promise<ProductFixture[]> {
    const { productsBySlug } = await this.getSnapshot();
    return Object.values(productsBySlug);
  }
}
