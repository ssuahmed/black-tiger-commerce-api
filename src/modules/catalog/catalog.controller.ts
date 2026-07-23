import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { CatalogService } from './catalog.service';
import { PriceQuoteDto } from './catalog.dto';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  @Public()
  @Get('categories/:slug')
  getCategory(@Param('slug') slug: string) {
    return this.catalog.getCategoryBySlug(slug);
  }

  @Public()
  @Get('products')
  listProducts(@Query() query: Record<string, string | string[]>) {
    return this.catalog.listProducts(query);
  }

  @Public()
  @Get('products/:slug')
  getProduct(@Param('slug') slug: string) {
    return this.catalog.getProductDetail(slug);
  }

  @UseGuards(OptionalJwtGuard)
  @Post('products/:slug/price-quote')
  quote(@Param('slug') slug: string, @Body() body: PriceQuoteDto) {
    return this.catalog.priceQuote(slug, body);
  }

  @Public()
  @Get('featured')
  featured() {
    return this.catalog.featured();
  }

  @Public()
  @Get('search')
  search(@Query('q') q?: string) {
    return this.catalog.search(q ?? '');
  }
}
