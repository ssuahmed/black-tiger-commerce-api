import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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

  @Get(':id')
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.quotes.getOne(req.user!.sub, id);
  }
}
