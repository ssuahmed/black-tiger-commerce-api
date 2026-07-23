import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.module';
import { OdooClient } from './odoo.client';

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

const FIXTURE_OPTIONS: StorefrontShippingOption[] = [
  {
    id: 'pallet-standard',
    label: 'Standard pallet freight',
    etaDays: 5,
    price: { currency: 'SAR', amount: 450, formatted: '450 SAR' },
  },
  {
    id: 'express-ltl',
    label: 'Express LTL',
    etaDays: 2,
    price: { currency: 'SAR', amount: 890, formatted: '890 SAR' },
  },
];

const CACHE_KEY = 'bt:shipping:options';
const DEFAULT_TTL_SEC = 300;

@Injectable()
export class OdooShippingService {
  private readonly logger = new Logger(OdooShippingService.name);
  private memory: { expiresAt: number; options: StorefrontShippingOption[] } | null = null;

  constructor(
    private readonly odoo: OdooClient,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  isLive(): boolean {
    return this.odoo.isConfigured();
  }

  async getStorefrontOptions(): Promise<StorefrontShippingOption[]> {
    if (!this.isLive()) {
      return FIXTURE_OPTIONS;
    }

    const cached = await this.getCached();
    if (cached) {
      return cached;
    }

    const items = await this.odoo.executeKw<StorefrontShippingOption[]>(
      'bt.storefront.shipping.option',
      'bt_get_storefront_options',
      [],
    );
    if (!items?.length) {
      this.logger.warn('Odoo returned no shipping options');
      throw new ServiceUnavailableException(
        'Shipping options unavailable — Odoo returned empty list',
      );
    }
    await this.setCached(items);
    return items;
  }

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
