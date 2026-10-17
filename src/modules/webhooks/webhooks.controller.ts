/**
 * HTTP entry for signed Odoo webhooks (cache invalidation only).
 *
 * Storefront → API ← Odoo: `POST /internal/webhooks/odoo` (outside the `v1` prefix)
 * receives model-change events; HMAC guard verifies before delegating to WebhooksService.
 */
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { WebhooksService, type OdooWebhookPayload } from './webhooks.service';

@Controller('internal/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Accept an Odoo change event and invalidate affected API caches. */
  @Post('odoo')
  @UseGuards(WebhookSignatureGuard)
  async odoo(@Body() body: OdooWebhookPayload) {
    return this.webhooks.handleOdooEvent(body);
  }
}
