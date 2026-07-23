import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IDEMPOTENCY_TTL_SEC } from '../../common/constants';
import { PersistenceService } from '../../persistence/persistence.service';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { AddCartItemDto, CreateCartDto, PatchCartItemDto } from './cart.dto';
import { CartService } from './cart.service';

@Controller('cart')
@UseGuards(OptionalJwtGuard)
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly persistence: PersistenceService,
  ) {}

  private uid(req: Request): string | undefined {
    return req.user?.sub;
  }

  @Post()
  create(@Body() dto: CreateCartDto, @Req() req: Request) {
    return this.cart.createCart(this.uid(req), dto.mergeCartId);
  }

  @Get(':cartId')
  getOne(@Param('cartId') cartId: string, @Req() req: Request) {
    return this.cart.getCart(cartId, this.uid(req));
  }

  @Post(':cartId/items')
  async addItem(
    @Param('cartId') cartId: string,
    @Body() dto: AddCartItemDto,
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
    const body = await this.cart.addItem(cartId, dto, this.uid(req));
    if (key) {
      await this.persistence.setIdempotentResponse(
        key,
        HttpStatus.CREATED,
        body,
        IDEMPOTENCY_TTL_SEC,
      );
    }
    res.status(HttpStatus.CREATED);
    return body;
  }

  @Patch(':cartId/items/:lineId')
  patchItem(
    @Param('cartId') cartId: string,
    @Param('lineId') lineId: string,
    @Body() dto: PatchCartItemDto,
    @Req() req: Request,
  ) {
    return this.cart.patchItem(cartId, lineId, dto, this.uid(req));
  }

  @Delete(':cartId/items/:lineId')
  @HttpCode(HttpStatus.OK)
  removeItem(
    @Param('cartId') cartId: string,
    @Param('lineId') lineId: string,
    @Req() req: Request,
  ) {
    return this.cart.removeItem(cartId, lineId, this.uid(req));
  }

  @Delete(':cartId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCart(
    @Param('cartId') cartId: string,
    @Req() req: Request,
  ): Promise<void> {
    this.cart.deleteCart(cartId, this.uid(req));
  }
}
