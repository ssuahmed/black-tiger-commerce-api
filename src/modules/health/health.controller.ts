import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationProbeService } from '../../infrastructure/integration/integration-probe.service';
import { RedisService } from '../../infrastructure/redis/redis.module';

@Controller()
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly integration: IntegrationProbeService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  async health() {
    const odooMode = this.config.get<string>('ODOO_MODE') === 'live' ? 'live' : 'mock';
    const redisOk = await this.redis.ping();
    return {
      status: 'ok',
      service: 'black-tiger-commerce-api',
      odooMode,
      redis: redisOk ? 'up' : this.config.get<string>('REDIS_URL')?.trim() ? 'down' : 'disabled',
    };
  }

  @Get('ready')
  async ready() {
    const probe = await this.integration.probe();
    const redisOk = await this.redis.ping();
    const redisConfigured = Boolean(this.config.get<string>('REDIS_URL')?.trim());
    if (redisConfigured && !redisOk) {
      probe.issues.push('REDIS_URL configured but Redis ping failed');
    }
    return {
      status: probe.status,
      redis: redisOk ? 'up' : redisConfigured ? 'down' : 'disabled',
      integration: {
        odooMode: probe.odooMode,
        sources: probe.sources,
        checks: probe.checks,
        issues: probe.issues,
      },
    };
  }
}
