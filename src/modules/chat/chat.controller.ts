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

  @Public()
  @Post('sessions')
  createSession(@Body() _dto: ChatSessionDto) {
    return this.chat.createSession();
  }

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
