/**
 * HTTP API for the storefront Ask AI widget (`/v1/chat/*`).
 *
 * Storefront → API: public session/message endpoints with optional JWT so
 * authenticated shoppers get the higher user rate-limit bucket; guests are
 * limited by client IP. Delegates to ChatService (catalog-backed, not direct Odoo).
 */
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { ChatMessageDto, ChatSessionDto } from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(OptionalJwtGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Start a new Ask AI session. */
  @Public()
  @Post('sessions')
  createSession(@Body() _dto: ChatSessionDto) {
    return this.chat.createSession();
  }

  /** Post a shopper message and receive a reply + product cards. */
  @Public()
  @Post('messages')
  postMessage(@Body() dto: ChatMessageDto, @Req() req: Request) {
    return this.chat.postMessage({
      message: dto.message,
      sessionId: dto.sessionId,
      userId: req.user?.sub,
      clientIp: this.clientIp(req),
    });
  }

  // Prefer first X-Forwarded-For hop when behind a reverse proxy.
  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]!.trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
      return String(forwarded[0]).split(',')[0]!.trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }
}
