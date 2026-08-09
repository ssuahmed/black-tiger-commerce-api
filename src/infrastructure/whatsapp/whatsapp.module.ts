import { Module } from '@nestjs/common';
import { WhatsAppCloudService } from './whatsapp-cloud.service';

@Module({
  providers: [WhatsAppCloudService],
  exports: [WhatsAppCloudService],
})
export class WhatsAppModule {}
