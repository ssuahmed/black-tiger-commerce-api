/**
 * Public CMS content HTTP API for storefront pages.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ContentService } from './content.service';

@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('pages')
  listPages() {
    return this.content.listPages();
  }

  @Public()
  @Get('pages/:slug')
  getPage(@Param('slug') slug: string) {
    return this.content.getPage(slug);
  }
}
