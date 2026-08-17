/**
 * Authenticated quotes HTTP API: create from cart, fetch snapshot, download PDF.
 */
import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Body,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuotesService } from './quotes.service';
import { QuoteCreateDto } from './quotes.dto';

@Controller('quotes')
@UseGuards(JwtAuthGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: QuoteCreateDto) {
    return this.quotes.create(req.user!.sub, dto);
  }

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = this.quotes.getPdf(req.user!.sub, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get(':id')
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.quotes.getOne(req.user!.sub, id);
  }
}
