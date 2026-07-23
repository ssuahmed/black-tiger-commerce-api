import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { WebhooksService, type OdooWebhookPayload } from './webhooks.service';

@Controller('internal/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('odoo')
  @UseGuards(WebhookSignatureGuard)
  async odoo(@Body() body: OdooWebhookPayload) {
    return this.webhooks.handleOdooEvent(body);
  }
}
