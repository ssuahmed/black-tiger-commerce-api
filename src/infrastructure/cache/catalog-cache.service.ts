import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OdooCatalogSnapshot } from '../odoo/odoo-catalog.loader';
import { RedisService } from '../redis/redis.module';

const SNAPSHOT_KEY = 'bt:catalog:snapshot';
const DEFAULT_TTL_SEC = 300;

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);
  private memory: { expiresAt: number; snapshot: OdooCatalogSnapshot } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  private ttlSec(): number {
    const raw = this.config.get<string>('CATALOG_CACHE_TTL_SEC');
    const n = raw ? Number(raw) : DEFAULT_TTL_SEC;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
  }

  async getSnapshot(): Promise<OdooCatalogSnapshot | null> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(SNAPSHOT_KEY);
      if (raw) {
        try {
          return JSON.parse(raw) as OdooCatalogSnapshot;
        } catch (err) {
          this.logger.warn(`Catalog snapshot parse failed: ${String(err)}`);
        }
      }
    }
    if (this.memory && this.memory.expiresAt > Date.now()) {
      return this.memory.snapshot;
    }
    return null;
  }

  async setSnapshot(snapshot: OdooCatalogSnapshot): Promise<void> {
    const ttl = this.ttlSec();
    if (this.redis.enabled) {
      const ok = await this.redis.setex(SNAPSHOT_KEY, ttl, JSON.stringify(snapshot));
      if (ok) return;
    }
    this.memory = {
      expiresAt: Date.now() + ttl * 1000,
      snapshot,
    };
  }

  async invalidateAll(): Promise<void> {
    if (this.redis.enabled) {
      await this.redis.del(SNAPSHOT_KEY);
    }
    this.memory = null;
    this.logger.log('Catalog cache invalidated');
  }
}
