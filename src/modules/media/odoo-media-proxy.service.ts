/**
 * Proxies Odoo `/web/image` and `/web/content` for the storefront.
 *
 * Catalog/CMS image URLs are rewritten to `/v1/media/odoo?path=…` so browsers
 * never call Odoo directly (hosts that require `X-Odoo-Database` cannot be
 * used from `<img>` tags). Fetches use ODOO_URL + optional DB header.
 */
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALLOWED_PREFIXES = ['/web/image/', '/web/content/'] as const;

export type OdooMediaFetchResult = {
  body: Buffer;
  contentType: string;
  contentDisposition?: string;
  etag?: string;
  lastModified?: string;
};

@Injectable()
export class OdooMediaProxyService {
  private readonly logger = new Logger(OdooMediaProxyService.name);

  constructor(private readonly config: ConfigService) {}

  private odooBaseUrl(): string {
    return (this.config.get<string>('ODOO_URL') || 'http://localhost:8069').replace(
      /\/$/,
      '',
    );
  }

  private odooDb(): string {
    return (this.config.get<string>('ODOO_DB') || '').trim();
  }

  /**
   * Public Commerce API base used in catalog/CMS image URLs.
   * Set PUBLIC_API_URL in staging/prod (e.g. https://api.example.com).
   */
  publicApiBase(): string {
    const configured = (this.config.get<string>('PUBLIC_API_URL') || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    const port = this.config.get<string>('PORT') || process.env.PORT || '3001';
    return `http://localhost:${port}`;
  }

  /** Build storefront-facing proxy URL for an Odoo /web/image or /web/content path. */
  proxyUrl(odooPath: string, query?: Record<string, string>): string {
    const path = odooPath.startsWith('/') ? odooPath : `/${odooPath}`;
    const url = new URL(`${this.publicApiBase()}/v1/media/odoo`);
    url.searchParams.set('path', path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (key === 'path') continue;
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /**
   * Rewrite Odoo media URLs (absolute or /web/image|/web/content paths) to the API proxy.
   * Any host is accepted for /web/image and /web/content so stale cache entries from a
   * previous ODOO_URL still rewrite. Leaves static/CDN URLs unchanged.
   */
  rewritePublicUrl(raw: string | null | undefined): string | null | undefined {
    if (raw == null || raw === '') return raw;
    const value = String(raw).trim();
    try {
      let path: string;
      let query: Record<string, string> | undefined;

      if (value.startsWith('/web/image/') || value.startsWith('/web/content/')) {
        const u = new URL(value, 'http://local.invalid');
        path = u.pathname;
        query = Object.fromEntries(u.searchParams.entries());
        delete query.db;
      } else if (/^https?:\/\//i.test(value)) {
        const u = new URL(value);
        if (
          !u.pathname.startsWith('/web/image/') &&
          !u.pathname.startsWith('/web/content/')
        ) {
          return value;
        }
        path = u.pathname;
        query = Object.fromEntries(u.searchParams.entries());
        delete query.db;
      } else {
        return value;
      }

      return this.proxyUrl(path, query);
    } catch {
      return value;
    }
  }

  /** Allow only `/web/image` and `/web/content` paths (no path traversal). */
  assertSafePath(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (normalized.includes('..') || normalized.includes('\\')) {
      throw new BadRequestException('Invalid media path');
    }
    if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw new BadRequestException('Media path not allowed');
    }
    return normalized;
  }

  /** Fetch binary media from Odoo and return headers needed for the proxy response. */
  async fetchOdooMedia(
    path: string,
    query?: Record<string, string>,
  ): Promise<OdooMediaFetchResult> {
    const safePath = this.assertSafePath(path);
    const target = new URL(`${this.odooBaseUrl()}${safePath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (key === 'path' || key === 'db') continue;
        target.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Accept: '*/*',
    };
    const db = this.odooDb();
    if (db) {
      // odoodatabase.it.com (and similar) select DB via header, not ?db=
      headers['X-Odoo-Database'] = db;
    }

    let res: Response;
    try {
      res = await fetch(target.toString(), { headers, redirect: 'follow' });
    } catch (err) {
      this.logger.warn(
        `Odoo media fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new NotFoundException('Media unavailable');
    }

    if (!res.ok) {
      this.logger.warn(
        `Odoo media ${target.pathname} → HTTP ${res.status} (db=${db || 'none'})`,
      );
      throw new NotFoundException('Media not found');
    }

    const arrayBuf = await res.arrayBuffer();
    return {
      body: Buffer.from(arrayBuf),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      contentDisposition: res.headers.get('content-disposition') || undefined,
      etag: res.headers.get('etag') || undefined,
      lastModified: res.headers.get('last-modified') || undefined,
    };
  }
}
