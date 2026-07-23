import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.module';

const PAGE_KEY = (slug: string) => `bt:content:page:${slug}`;
const PAGE_SLUGS_KEY = 'bt:content:page:slugs';
const LIST_KEY = 'bt:content:pages:index';
const DEFAULT_TTL_SEC = 300;

/**
 * CMS content cache (Redis + in-memory fallback).
 * Invalidated by Odoo webhooks for bt.website.page / bt.website.section.
 */
@Injectable()
export class ContentCacheService {
  private readonly logger = new Logger(ContentCacheService.name);
  private readonly memoryPages = new Map<string, { expiresAt: number; data: unknown }>();
  private memoryList: { expiresAt: number; data: unknown } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  private ttlSec(): number {
    const raw = this.config.get<string>('CONTENT_CACHE_TTL_SEC');
    const n = raw ? Number(raw) : DEFAULT_TTL_SEC;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
  }

  async getPage<T>(slug: string): Promise<T | null> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(PAGE_KEY(slug));
      if (raw) {
        try {
          return JSON.parse(raw) as T;
        } catch (err) {
          this.logger.warn(`Content page parse failed (${slug}): ${String(err)}`);
        }
      }
    }
    const row = this.memoryPages.get(slug);
    if (!row || row.expiresAt < Date.now()) {
      return null;
    }
    return row.data as T;
  }

  async setPage(slug: string, data: unknown): Promise<void> {
    const ttl = this.ttlSec();
    if (this.redis.enabled) {
      const ok = await this.redis.setex(PAGE_KEY(slug), ttl, JSON.stringify(data));
      if (ok) {
        await this.redis.sadd(PAGE_SLUGS_KEY, slug);
        return;
      }
    }
    this.memoryPages.set(slug, { expiresAt: Date.now() + ttl * 1000, data });
  }

  async getPageList<T>(): Promise<T | null> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(LIST_KEY);
      if (raw) {
        try {
          return JSON.parse(raw) as T;
        } catch (err) {
          this.logger.warn(`Content list parse failed: ${String(err)}`);
        }
      }
    }
    if (this.memoryList && this.memoryList.expiresAt > Date.now()) {
      return this.memoryList.data as T;
    }
    return null;
  }

  async setPageList(data: unknown): Promise<void> {
    const ttl = this.ttlSec();
    if (this.redis.enabled) {
      const ok = await this.redis.setex(LIST_KEY, ttl, JSON.stringify(data));
      if (ok) return;
    }
    this.memoryList = { expiresAt: Date.now() + ttl * 1000, data };
  }

  async invalidatePage(slug: string): Promise<void> {
    if (this.redis.enabled) {
      await this.redis.del(PAGE_KEY(slug));
      await this.redis.del(LIST_KEY);
    }
    this.memoryPages.delete(slug);
    this.memoryList = null;
    this.logger.debug(`Content cache cleared: ${slug}`);
  }

  async invalidateAll(): Promise<void> {
    if (this.redis.enabled) {
      const slugs = await this.redis.smembers(PAGE_SLUGS_KEY);
      const keys = [LIST_KEY, PAGE_SLUGS_KEY, ...slugs.map((s) => PAGE_KEY(s))];
      await this.redis.delMany(keys);
    }
    this.memoryPages.clear();
    this.memoryList = null;
    this.logger.log('Content cache invalidated (all pages)');
  }
}
