import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentService } from './payment.service';

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller('internal/webhooks')
export class PayTabsWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post('paytabs')
  @HttpCode(HttpStatus.OK)
  handle(
    @Req() req: RequestWithRawBody,
    @Headers('signature') signature?: string,
  ) {
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new UnauthorizedException('Missing raw body for PayTabs signature');
    }
    return this.payments.handlePayTabsCallback(raw, signature);
  }
}
