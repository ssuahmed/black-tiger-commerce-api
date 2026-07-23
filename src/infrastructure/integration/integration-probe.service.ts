import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { productLooksLikeMock } from '../../common/integration/mock-markers';
import { CatalogProductsProvider } from '../../modules/catalog/catalog-products.provider';
import { ContentService } from '../../modules/content/content.service';
import { OdooClient } from '../odoo/odoo.client';
import { OdooShippingService } from '../odoo/odoo-shipping.service';

export type IntegrationProbeResult = {
  status: 'ready' | 'degraded';
  odooMode: 'live' | 'mock';
  sources: {
    catalog: 'odoo' | 'mock' | 'unknown' | 'error';
    content: 'odoo' | 'mock' | 'unknown' | 'error';
    shipping: 'odoo' | 'mock' | 'unknown' | 'error';
  };
  checks: {
    catalogProductCount: number;
    mockCatalogMarkers: boolean;
    cmsPageCount: number;
    shippingOptionCount: number;
  };
  issues: string[];
};

@Injectable()
export class IntegrationProbeService {
  constructor(
    private readonly config: ConfigService,
    private readonly odoo: OdooClient,
    private readonly catalog: CatalogProductsProvider,
    private readonly content: ContentService,
    private readonly shipping: OdooShippingService,
  ) {}

  isLiveMode(): boolean {
    return this.odoo.isConfigured();
  }

  async probe(): Promise<IntegrationProbeResult> {
    const odooMode = this.isLiveMode() ? 'live' : 'mock';
    const issues: string[] = [];
    const sources = {
      catalog: 'unknown' as IntegrationProbeResult['sources']['catalog'],
      content: 'unknown' as IntegrationProbeResult['sources']['content'],
      shipping: 'unknown' as IntegrationProbeResult['sources']['shipping'],
    };

    let catalogProductCount = 0;
    let mockCatalogMarkers = false;
    let cmsPageCount = 0;
    let shippingOptionCount = 0;

    try {
      const snap = await this.catalog.getSnapshot();
      sources.catalog = snap.source;
      const products = Object.values(snap.productsBySlug);
      catalogProductCount = products.length;
      mockCatalogMarkers = products.some((p) => productLooksLikeMock(p));
      if (odooMode === 'live' && snap.source !== 'odoo') {
        issues.push(`catalog source is "${snap.source}" but ODOO_MODE=live`);
      }
      if (odooMode === 'live' && mockCatalogMarkers) {
        issues.push('catalog products contain mock markers (pkg-box-* or placehold.co)');
      }
      if (odooMode === 'live' && catalogProductCount === 0) {
        issues.push('catalog returned zero products in live mode');
      }
    } catch (err) {
      sources.catalog = 'error';
      issues.push(
        `catalog probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const pages = await this.content.listPages();
      cmsPageCount = pages.length;
      if (odooMode === 'live') {
        const hasHome = pages.some((p) => p.slug === 'home');
        sources.content = hasHome && cmsPageCount > 0 ? 'odoo' : 'mock';
        if (!hasHome) {
          issues.push('CMS pages missing expected Odoo seed slug "home"');
        }
      } else {
        sources.content = 'mock';
      }
    } catch (err) {
      sources.content = 'error';
      issues.push(
        `content probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const opts = await this.shipping.getStorefrontOptions();
      shippingOptionCount = opts.length;
      if (odooMode === 'live') {
        sources.shipping = shippingOptionCount > 0 ? 'odoo' : 'unknown';
        if (shippingOptionCount === 0) {
          issues.push('shipping returned zero options in live mode');
        }
      } else {
        sources.shipping = 'mock';
      }
    } catch (err) {
      sources.shipping = 'error';
      issues.push(
        `shipping probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const degraded =
      odooMode === 'live' &&
      (issues.length > 0 ||
        sources.catalog !== 'odoo' ||
        sources.content !== 'odoo' ||
        mockCatalogMarkers);

    return {
      status: degraded ? 'degraded' : 'ready',
      odooMode,
      sources,
      checks: {
        catalogProductCount,
        mockCatalogMarkers,
        cmsPageCount,
        shippingOptionCount,
      },
      issues,
    };
  }
}
