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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IDEMPOTENCY_TTL_SEC } from '../../common/constants';
import { PersistenceService } from '../../persistence/persistence.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AddListToCartDto,
  BulkAddSavedListItemsDto,
  CreateSavedListDto,
  ListLineInputDto,
  UpdateSavedListDto,
  UpdateSavedListItemDto,
} from './lists.dto';
import { ListsService } from './lists.service';

@Controller('lists')
@UseGuards(JwtAuthGuard)
export class ListsController {
  constructor(
    private readonly lists: ListsService,
    private readonly persistence: PersistenceService,
  ) {}

  private uid(req: Request): string {
    return req.user!.sub;
  }

  @Get()
  list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ) {
    return this.lists.list(
      this.uid(req),
      Number(page ?? 1) || 1,
      Number(pageSize ?? 20) || 20,
      sort ?? 'updatedAt_desc',
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: Request, @Body() dto: CreateSavedListDto) {
    return this.lists.create(this.uid(req), dto);
  }

  @Get(':listId')
  one(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Query('includeItems') includeItems?: string,
  ) {
    const incl =
      includeItems === undefined ? true : includeItems !== 'false';
    return this.lists.detail(this.uid(req), listId, incl);
  }

  @Patch(':listId')
  patch(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Body() dto: UpdateSavedListDto,
  ) {
    return this.lists.patch(this.uid(req), listId, dto);
  }

  @Delete(':listId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('listId') listId: string): void {
    this.lists.delete(this.uid(req), listId);
  }

  @Get(':listId/items')
  items(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.lists.itemsPage(
      this.uid(req),
      listId,
      Number(page ?? 1) || 1,
      Number(pageSize ?? 50) || 50,
    );
  }

  @Post(':listId/items')
  @HttpCode(HttpStatus.CREATED)
  addLine(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Body() dto: ListLineInputDto,
  ) {
    return this.lists.addItem(this.uid(req), listId, dto);
  }

  @Post(':listId/items/bulk')
  bulk(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Body() dto: BulkAddSavedListItemsDto,
  ) {
    return this.lists.bulk(this.uid(req), listId, dto);
  }

  @Delete(':listId/items')
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@Req() req: Request, @Param('listId') listId: string): void {
    this.lists.clearItems(this.uid(req), listId);
  }

  @Patch(':listId/items/:itemId')
  patchLine(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSavedListItemDto,
  ) {
    return this.lists.patchItem(this.uid(req), listId, itemId, dto);
  }

  @Delete(':listId/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  rmLine(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Param('itemId') itemId: string,
  ): void {
    this.lists.removeItem(this.uid(req), listId, itemId);
  }

  @Post(':listId/add-to-cart')
  async addToCart(
    @Req() req: Request,
    @Param('listId') listId: string,
    @Body() dto: AddListToCartDto,
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
    const body = this.lists.addListToCart(this.uid(req), listId, dto);
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
