import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module';
import { PaymentService } from './payment.service';
import { PayTabsPaymentGateway } from './paytabs-payment.gateway';
import { SandboxPaymentGateway } from './sandbox-payment.gateway';
import { PayTabsWebhookController } from './paytabs-webhook.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [PayTabsWebhookController],
  providers: [PaymentService, SandboxPaymentGateway, PayTabsPaymentGateway],
  exports: [PaymentService],
})
export class PaymentModule {}
