import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis client for catalog cache, idempotency, Ask AI limits/sessions.
 * When REDIS_URL is unset or unreachable, callers fall back to in-memory behavior.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    if (!url) {
      this.logger.log('REDIS_URL unset — using in-memory fallbacks');
      return;
    }

    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    redis.on('error', (err) => {
      this.logger.warn(`Redis error: ${String(err.message)}`);
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`unexpected ping response: ${pong}`);
      }
      this.client = redis;
      this.logger.log('Redis connected');
    } catch (err) {
      await this.safeQuit(redis);
      this.logger.warn(
        `Redis unavailable — in-memory fallbacks: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.safeQuit(this.client);
    this.client = null;
  }

  get enabled(): boolean {
    return this.client != null;
  }

  getClient(): Redis | null {
    return this.client;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(`Redis GET ${key}: ${String(err)}`);
      return null;
    }
  }

  async setex(key: string, ttlSec: number, value: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.setex(key, ttlSec, value);
      return true;
    } catch (err) {
      this.logger.warn(`Redis SETEX ${key}: ${String(err)}`);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      this.logger.warn(`Redis DEL ${key}: ${String(err)}`);
      return false;
    }
  }

  async delMany(keys: string[]): Promise<boolean> {
    if (!this.client || keys.length === 0) return false;
    try {
      await this.client.del(...keys);
      return true;
    } catch (err) {
      this.logger.warn(`Redis DEL many: ${String(err)}`);
      return false;
    }
  }

  async sadd(key: string, member: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.sadd(key, member);
      return true;
    } catch (err) {
      this.logger.warn(`Redis SADD ${key}: ${String(err)}`);
      return false;
    }
  }

  async smembers(key: string): Promise<string[]> {
    if (!this.client) return [];
    try {
      return await this.client.smembers(key);
    } catch (err) {
      this.logger.warn(`Redis SMEMBERS ${key}: ${String(err)}`);
      return [];
    }
  }

  async incr(key: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      return await this.client.incr(key);
    } catch (err) {
      this.logger.warn(`Redis INCR ${key}: ${String(err)}`);
      return null;
    }
  }

  async expire(key: string, ttlSec: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.expire(key, ttlSec);
      return true;
    } catch (err) {
      this.logger.warn(`Redis EXPIRE ${key}: ${String(err)}`);
      return false;
    }
  }

  async ttl(key: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      return await this.client.ttl(key);
    } catch (err) {
      this.logger.warn(`Redis TTL ${key}: ${String(err)}`);
      return null;
    }
  }

  async decr(key: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      return await this.client.decr(key);
    } catch (err) {
      this.logger.warn(`Redis DECR ${key}: ${String(err)}`);
      return null;
    }
  }

  private async safeQuit(client: Redis | null): Promise<void> {
    if (!client) return;
    try {
      await client.quit();
    } catch {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
