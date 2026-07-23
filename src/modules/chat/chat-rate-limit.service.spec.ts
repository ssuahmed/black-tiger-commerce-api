import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ChatRateLimitService } from './chat-rate-limit.service';
import type { RedisService } from '../../infrastructure/redis/redis.module';

describe('ChatRateLimitService', () => {
  function svc(env: Record<string, string> = {}) {
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    const redis = {
      enabled: false,
      incr: jest.fn(),
      decr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
    } as unknown as RedisService;
    return new ChatRateLimitService(config, redis);
  }

  it('allows guest messages up to daily limit then 429', async () => {
    const limit = svc({
      CHAT_LIMIT_GUEST_DAILY: '3',
      CHAT_LIMIT_GUEST_BURST: '10',
      CHAT_LIMIT_BURST_WINDOW_SEC: '60',
    });
    expect((await limit.consume('guest', '1.2.3.4')).remaining).toBe(2);
    expect((await limit.consume('guest', '1.2.3.4')).remaining).toBe(1);
    expect((await limit.consume('guest', '1.2.3.4')).remaining).toBe(0);
    await expect(limit.consume('guest', '1.2.3.4')).rejects.toBeInstanceOf(HttpException);
    try {
      await limit.consume('guest', '1.2.3.4');
      fail('expected 429');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('tracks logged-in users separately from guests', async () => {
    const limit = svc({
      CHAT_LIMIT_GUEST_DAILY: '1',
      CHAT_LIMIT_USER_DAILY: '2',
      CHAT_LIMIT_GUEST_BURST: '10',
      CHAT_LIMIT_USER_BURST: '10',
    });
    await limit.consume('guest', '9.9.9.9');
    await expect(limit.consume('guest', '9.9.9.9')).rejects.toBeInstanceOf(HttpException);
    const u1 = await limit.consume('user', 'user-a');
    expect(u1.identity).toBe('user');
    expect(u1.remaining).toBe(1);
    expect((await limit.consume('user', 'user-a')).remaining).toBe(0);
  });

  it('enforces burst limit independently of daily', async () => {
    const limit = svc({
      CHAT_LIMIT_GUEST_DAILY: '100',
      CHAT_LIMIT_GUEST_BURST: '2',
      CHAT_LIMIT_BURST_WINDOW_SEC: '60',
    });
    await limit.consume('guest', 'burst-ip');
    await limit.consume('guest', 'burst-ip');
    try {
      await limit.consume('guest', 'burst-ip');
      fail('expected burst 429');
    } catch (err) {
      const body = (err as HttpException).getResponse() as { error?: string };
      expect(body.error).toBe('CHAT_BURST_LIMIT');
    }
  });
});
