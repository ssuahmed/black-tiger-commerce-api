import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infrastructure/redis/redis.module';

export type ChatIdentityKind = 'user' | 'guest';

export interface ChatUsageSnapshot {
  identity: ChatIdentityKind;
  limit: number;
  remaining: number;
  resetAt: string;
  burstLimit: number;
  burstRemaining: number;
}

type MemoryBucket = {
  dayKey: string;
  dayCount: number;
  burstStartedAt: number;
  burstCount: number;
};

@Injectable()
export class ChatRateLimitService {
  private readonly memory = new Map<string, MemoryBucket>();

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Consume one message quota for the caller.
   * @throws HttpException 429 when over daily or burst limit
   */
  async consume(identity: ChatIdentityKind, subject: string): Promise<ChatUsageSnapshot> {
    if (this.redis.enabled) {
      const redisResult = await this.consumeRedis(identity, subject);
      if (redisResult) return redisResult;
    }
    return this.consumeMemory(identity, subject);
  }

  private async consumeRedis(
    identity: ChatIdentityKind,
    subject: string,
  ): Promise<ChatUsageSnapshot | null> {
    const dailyLimit = this.dailyLimit(identity);
    const burstLimit = this.burstLimit(identity);
    const burstWindowSec = this.burstWindowSec();
    const now = Date.now();
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const dailyRedisKey = `bt:chat:limit:daily:${identity}:${subject}:${dayKey}`;
    const burstRedisKey = `bt:chat:limit:burst:${identity}:${subject}`;

    const dayCount = await this.redis.incr(dailyRedisKey);
    if (dayCount == null) return null;
    if (dayCount === 1) {
      await this.redis.expire(dailyRedisKey, this.secondsUntilUtcDayEnd(dayKey));
    }
    if (dayCount > dailyLimit) {
      await this.redis.decr(dailyRedisKey);
      throw this.tooMany(identity, dailyLimit, this.endOfUtcDayIso(dayKey), 'daily');
    }

    const burstCount = await this.redis.incr(burstRedisKey);
    if (burstCount == null) {
      await this.redis.decr(dailyRedisKey);
      return null;
    }
    if (burstCount === 1) {
      await this.redis.expire(burstRedisKey, burstWindowSec);
    }
    if (burstCount > burstLimit) {
      await this.redis.decr(burstRedisKey);
      await this.redis.decr(dailyRedisKey);
      const ttl = (await this.redis.ttl(burstRedisKey)) ?? burstWindowSec;
      const resetAt = new Date(now + Math.max(ttl, 1) * 1000).toISOString();
      throw this.tooMany(identity, burstLimit, resetAt, 'burst');
    }

    return {
      identity,
      limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - dayCount),
      resetAt: this.endOfUtcDayIso(dayKey),
      burstLimit,
      burstRemaining: Math.max(0, burstLimit - burstCount),
    };
  }

  private consumeMemory(identity: ChatIdentityKind, subject: string): ChatUsageSnapshot {
    const key = `${identity}:${subject}`;
    const dailyLimit = this.dailyLimit(identity);
    const burstLimit = this.burstLimit(identity);
    const burstWindowMs = this.burstWindowSec() * 1000;
    const now = Date.now();
    const dayKey = new Date(now).toISOString().slice(0, 10);

    let bucket = this.memory.get(key);
    if (!bucket || bucket.dayKey !== dayKey) {
      bucket = {
        dayKey,
        dayCount: 0,
        burstStartedAt: now,
        burstCount: 0,
      };
    }

    if (now - bucket.burstStartedAt >= burstWindowMs) {
      bucket.burstStartedAt = now;
      bucket.burstCount = 0;
    }

    if (bucket.dayCount >= dailyLimit) {
      throw this.tooMany(identity, dailyLimit, this.endOfUtcDayIso(dayKey), 'daily');
    }
    if (bucket.burstCount >= burstLimit) {
      const resetAt = new Date(bucket.burstStartedAt + burstWindowMs).toISOString();
      throw this.tooMany(identity, burstLimit, resetAt, 'burst');
    }

    bucket.dayCount += 1;
    bucket.burstCount += 1;
    this.memory.set(key, bucket);

    if (this.memory.size > 5000) {
      for (const [k, b] of this.memory) {
        if (b.dayKey !== dayKey) this.memory.delete(k);
      }
    }

    return {
      identity,
      limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - bucket.dayCount),
      resetAt: this.endOfUtcDayIso(dayKey),
      burstLimit,
      burstRemaining: Math.max(0, burstLimit - bucket.burstCount),
    };
  }

  private dailyLimit(identity: ChatIdentityKind): number {
    if (identity === 'user') {
      return this.intEnv('CHAT_LIMIT_USER_DAILY', 40);
    }
    return this.intEnv('CHAT_LIMIT_GUEST_DAILY', 10);
  }

  private burstLimit(identity: ChatIdentityKind): number {
    if (identity === 'user') {
      return this.intEnv('CHAT_LIMIT_USER_BURST', 10);
    }
    return this.intEnv('CHAT_LIMIT_GUEST_BURST', 5);
  }

  private burstWindowSec(): number {
    return this.intEnv('CHAT_LIMIT_BURST_WINDOW_SEC', 60);
  }

  private intEnv(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const n = raw != null && raw !== '' ? Number(raw) : fallback;
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.floor(n);
  }

  private secondsUntilUtcDayEnd(dayKey: string): number {
    const end = new Date(`${dayKey}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return Math.max(60, Math.ceil((end.getTime() - Date.now()) / 1000));
  }

  private endOfUtcDayIso(dayKey: string): string {
    const next = new Date(`${dayKey}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }

  private tooMany(
    identity: ChatIdentityKind,
    limit: number,
    resetAt: string,
    kind: 'daily' | 'burst',
  ): HttpException {
    const who = identity === 'user' ? 'your account' : 'this device / network';
    const message =
      kind === 'daily'
        ? `Ask AI daily limit reached for ${who} (${limit} messages). Try again after ${resetAt}.`
        : `Ask AI is temporarily rate-limited for ${who}. Please wait a moment and try again.`;
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        error: kind === 'daily' ? 'CHAT_DAILY_LIMIT' : 'CHAT_BURST_LIMIT',
        details: [
          {
            code: kind === 'daily' ? 'CHAT_DAILY_LIMIT' : 'CHAT_BURST_LIMIT',
            message: `${identity} limit=${limit} resetAt=${resetAt}`,
          },
        ],
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
