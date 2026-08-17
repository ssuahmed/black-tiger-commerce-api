/**
 * Global media Nest module: Odoo image/content proxy used by catalog and CMS.
 */
import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { OdooMediaProxyService } from './odoo-media-proxy.service';

@Global()
@Module({
  controllers: [MediaController],
  providers: [OdooMediaProxyService],
  exports: [OdooMediaProxyService],
})
export class MediaModule {}
