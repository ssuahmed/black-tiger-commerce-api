/**
 * Nest module for storefront Ask AI (rules + optional LLM).
 *
 * Storefront → API → catalog: wires ChatController/Service with CatalogModule
 * (products may be loaded from Odoo upstream) and AuthModule for optional JWT
 * identity on rate limits.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatController } from './chat.controller';
import { ChatLlmProvider } from './chat-llm.provider';
import { ChatRateLimitService } from './chat-rate-limit.service';
import { ChatRulesProvider } from './chat-rules.provider';
import { ChatService } from './chat.service';

@Module({
  imports: [CatalogModule, AuthModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRulesProvider, ChatLlmProvider, ChatRateLimitService],
  exports: [ChatService],
})
export class ChatModule {}
