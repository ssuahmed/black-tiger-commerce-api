import { Module } from '@nestjs/common';
import { IntegrationModule } from '../../infrastructure/integration/integration.module';
import { HealthController } from './health.controller';

@Module({
  imports: [IntegrationModule],
  controllers: [HealthController],
})
export class HealthModule {}
