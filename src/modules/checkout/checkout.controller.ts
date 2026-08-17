/**
 * Authenticated checkout HTTP API: address resolve (Google Maps), warehouses,
 * shipping options, payment intents, and idempotent order submit.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IDEMPOTENCY_TTL_SEC } from '../../common/constants';
import { PersistenceService } from '../../persistence/persistence.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CheckoutAddressDto,
  CheckoutConfirmPaymentDto,
  CheckoutPaymentIntentDto,
  CheckoutShippingDto,
  CheckoutSubmitDto,
  ResolveCheckoutAddressDto,
} from './checkout.dto';
import { CheckoutService } from './checkout.service';
import { GoogleGeocodingService } from '../../infrastructure/google-maps/google-geocoding.service';

@Controller('checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly persistence: PersistenceService,
    private readonly geocoding: GoogleGeocodingService,
  ) {}

  private uid(req: Request): string {
    return req.user!.sub;
  }

  @Get(':cartId/summary')
  summary(@Param('cartId') cartId: string, @Req() req: Request) {
    return this.checkout.getSummary(cartId, this.uid(req));
  }

  @Post('address/resolve')
  resolveAddress(@Body() dto: ResolveCheckoutAddressDto) {
    return this.geocoding.resolve(dto);
  }

  @Get('warehouses')
  warehouses() {
    return this.checkout.listWarehouses();
  }

  @Get('warehouses/:slug')
  warehouse(@Param('slug') slug: string) {
    return this.checkout.getWarehouse(slug);
  }

  @Put(':cartId/address')
  async address(
    @Param('cartId') cartId: string,
    @Body() dto: CheckoutAddressDto,
    @Req() req: Request,
  ) {
    return this.checkout.putAddress(cartId, this.uid(req), dto);
  }

  @Get(':cartId/shipping-options')
  async shippingOpts(@Param('cartId') cartId: string, @Req() req: Request) {
    return this.checkout.shippingOptions(cartId, this.uid(req));
  }

  @Put(':cartId/shipping')
  async shipping(
    @Param('cartId') cartId: string,
    @Body() dto: CheckoutShippingDto,
    @Req() req: Request,
  ) {
    return this.checkout.putShipping(cartId, this.uid(req), dto);
  }

  @Post(':cartId/payment-intent')
  payIntent(
    @Param('cartId') cartId: string,
    @Body() dto: CheckoutPaymentIntentDto,
    @Req() req: Request,
  ) {
    return this.checkout.paymentIntent(cartId, this.uid(req), dto.method);
  }

  @Get(':cartId/payment-intent')
  getPayIntent(@Param('cartId') cartId: string, @Req() req: Request) {
    return this.checkout.getPaymentIntent(cartId, this.uid(req));
  }

  @Post(':cartId/payment-intent/confirm')
  confirmPayIntent(
    @Param('cartId') cartId: string,
    @Body() dto: CheckoutConfirmPaymentDto,
    @Req() req: Request,
  ) {
    return this.checkout.confirmPaymentIntent(
      cartId,
      this.uid(req),
      dto.paymentIntentId,
    );
  }

  @Post(':cartId/submit')
  async submit(
    @Param('cartId') cartId: string,
    @Body() _dto: CheckoutSubmitDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idem?: string,
  ) {
    const key = idem?.trim();
    if (key) {
      const cached = await this.persistence.getIdempotentResponse(key);
      if (cached) {
        res.status(cached.status);
        return cached.body;
      }
    }
    const body = await this.checkout.submit(cartId, this.uid(req), _dto);
    if (key) {
      await this.persistence.setIdempotentResponse(
        key,
        HttpStatus.OK,
        body,
        IDEMPOTENCY_TTL_SEC,
      );
    }
    return body;
  }
}
