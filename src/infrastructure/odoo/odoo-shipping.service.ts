/**
 * Storefront freight options: vehicle-catalog fixtures with optional Odoo overrides.
 *
 * Storefront → API → Odoo: checkout reads shipping options here. When not live, or when
 * Odoo returns nothing / errors, the API-owned vehicle catalog is the source of truth.
 * Successful live reads are cached in Redis (with in-memory fallback).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.module';
import { OdooClient } from './odoo.client';
import { vehicleCatalogAsStorefrontOptions } from '../../modules/checkout/vehicle-fleet';

export interface StorefrontShippingOption {
  id: string;
  label: string;
  etaDays: number;
  price: {
    currency: string;
    amount: number;
    formatted: string;
  };
}

/** Vehicle catalog is SSOT for storefront freight (mock tiered costs). */
const FIXTURE_OPTIONS: StorefrontShippingOption[] =
  vehicleCatalogAsStorefrontOptions();

const CACHE_KEY = 'bt:shipping:options';
const DEFAULT_TTL_SEC = 300;

/** Legacy method codes no longer offered at checkout. */
const REMOVED_SHIPPING_OPTION_IDS = new Set([
  'express-ltl',
  'pallet-standard',
]);

function withoutRemovedShippingOptions(
  options: StorefrontShippingOption[],
): StorefrontShippingOption[] {
  return options.filter((row) => row?.id && !REMOVED_SHIPPING_OPTION_IDS.has(row.id));
}

@Injectable()
export class OdooShippingService {
  private readonly logger = new Logger(OdooShippingService.name);
  private memory: { expiresAt: number; options: StorefrontShippingOption[] } | null = null;

  constructor(
    private readonly odoo: OdooClient,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Whether shipping options may be loaded from live Odoo. */
  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  /** Return checkout shipping options (cache → Odoo → fixture fallback). */
  async getStorefrontOptions(): Promise<StorefrontShippingOption[]> {
    // Fall back to fixtures when ODOO_MODE != live.
    // Always expose the vehicle catalog for packing/pricing. Live Odoo may
    // override labels later; capacities and mock costs stay API-owned for now.
    if (!this.isLive()) {
      return FIXTURE_OPTIONS;
    }

    const cached = await this.getCached();
    if (cached?.length) {
      const filtered = withoutRemovedShippingOptions(cached);
      if (filtered.length) return filtered;
    }

    try {
      const items = await this.odoo.executeKw<StorefrontShippingOption[]>(
        'bt.storefront.shipping.option',
        'bt_get_storefront_options',
        [],
      );
      const filtered = withoutRemovedShippingOptions(items ?? []);
      if (filtered.length) {
        await this.setCached(filtered);
        return filtered;
      }
      this.logger.warn(
        'Odoo returned no vehicle shipping options — using API vehicle catalog',
      );
    } catch (err) {
      this.logger.warn(
        `Odoo shipping options failed — using API vehicle catalog: ${String(err)}`,
      );
    }
    return FIXTURE_OPTIONS;
  }

  /** Drop Redis + in-memory shipping option cache (e.g. after webhook). */
  async invalidateCache(): Promise<void> {
    if (this.redis.enabled) {
      await this.redis.del(CACHE_KEY);
    }
    this.memory = null;
    this.logger.log('Shipping options cache invalidated');
  }

  private ttlSec(): number {
    const raw = this.config.get<string>('SHIPPING_CACHE_TTL_SEC');
    const n = raw ? Number(raw) : DEFAULT_TTL_SEC;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
  }

  // Prefer Redis; fall back to process-local TTL cache when Redis is down/disabled.
  private async getCached(): Promise<StorefrontShippingOption[] | null> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(CACHE_KEY);
      if (raw) {
        try {
          return JSON.parse(raw) as StorefrontShippingOption[];
        } catch (err) {
          this.logger.warn(`Shipping cache parse failed: ${String(err)}`);
        }
      }
    }
    if (this.memory && this.memory.expiresAt > Date.now()) {
      return this.memory.options;
    }
    return null;
  }

  private async setCached(options: StorefrontShippingOption[]): Promise<void> {
    const ttl = this.ttlSec();
    if (this.redis.enabled) {
      const ok = await this.redis.setex(CACHE_KEY, ttl, JSON.stringify(options));
      if (ok) return;
    }
    this.memory = { expiresAt: Date.now() + ttl * 1000, options };
  }
}
