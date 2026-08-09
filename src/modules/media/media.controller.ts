import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { OdooMediaProxyService } from './odoo-media-proxy.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: OdooMediaProxyService) {}

  /**
   * Proxy Odoo /web/image and /web/content for the storefront.
   * Hosts like odoodatabase.it.com require X-Odoo-Database (browsers cannot set that on img tags).
   *
   * Example: GET /v1/media/odoo?path=/web/image/bt.product.image/1/image
   */
  @Public()
  @Get('odoo')
  async proxyOdooMedia(
    @Query('path') path: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!path?.trim()) {
      return res.status(400).json({
        success: false,
        error: { message: 'Query param path is required' },
      });
    }

    const file = await this.media.fetchOdooMedia(path.trim(), query);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (file.contentDisposition) {
      res.setHeader('Content-Disposition', file.contentDisposition);
    }
    if (file.etag) {
      res.setHeader('ETag', file.etag);
    }
    if (file.lastModified) {
      res.setHeader('Last-Modified', file.lastModified);
    }
    return res.status(200).send(file.body);
  }
}
