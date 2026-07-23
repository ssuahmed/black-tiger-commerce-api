import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CONTENT_PAGES, type ContentPageFixture } from '../../mocks/content.fixtures';
import { ContentCacheService } from '../../infrastructure/cache/content-cache.service';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';

type PageListItem = { slug: string; name: string; published: boolean };

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly odoo: OdooClient,
    private readonly contentCache: ContentCacheService,
  ) {}

  async listPages(): Promise<PageListItem[]> {
    const cached = await this.contentCache.getPageList<PageListItem[]>();
    if (cached) {
      return cached;
    }

    if (this.odoo.isConfigured()) {
      try {
        const rows = await this.odoo.executeKw<
          Array<{ slug: string; name: string; is_published: boolean }>
        >('bt.website.page', 'search_read', [[['is_published', '=', true]]], {
          fields: ['slug', 'name', 'is_published'],
          order: 'name asc',
        });
        const result = rows.map((r) => ({
          slug: r.slug,
          name: r.name,
          published: r.is_published,
        }));
        await this.contentCache.setPageList(result);
        return result;
      } catch (err) {
        if (this.odoo.isConfigured()) {
          this.logger.error(`Odoo CMS list failed: ${String(err)}`);
          throw new ServiceUnavailableException(
            'Content pages unavailable — Odoo live load failed',
          );
        }
      }
    }
    return Object.values(CONTENT_PAGES).map((p) => ({
      slug: p.slug,
      name: p.name,
      published: p.published,
    }));
  }

  async getPage(slug: string): Promise<ContentPageFixture> {
    const cached = await this.contentCache.getPage<ContentPageFixture>(slug);
    if (cached) {
      return cached;
    }

    if (this.odoo.isConfigured()) {
      try {
        const pages = await this.odoo.executeKw<
          Array<{ slug: string; name: string; is_published: boolean }>
        >('bt.website.page', 'search_read', [[['slug', '=', slug], ['is_published', '=', true]]], {
          fields: ['slug', 'name', 'is_published'],
          limit: 1,
        });
        const page = pages[0];
        if (page) {
          const blocks = await this.odoo.getWebsitePageBlocks(slug);
          const result = {
            slug: page.slug,
            name: page.name,
            published: page.is_published,
            blocks: blocks as ContentPageFixture['blocks'],
          };
          await this.contentCache.setPage(slug, result);
          return result;
        }
        if (this.odoo.isConfigured()) {
          throw new NotFoundException(`Content page not found in Odoo: ${slug}`);
        }
      } catch (err) {
        if (this.odoo.isConfigured()) {
          if (err instanceof NotFoundException) {
            throw err;
          }
          this.logger.error(`Odoo CMS page load failed: ${String(err)}`);
          throw new ServiceUnavailableException(
            'Content page unavailable — Odoo live load failed',
          );
        }
      }
    }

    const fixture = CONTENT_PAGES[slug];
    if (!fixture) {
      throw new NotFoundException(`Content page not found: ${slug}`);
    }
    return fixture;
  }
}
