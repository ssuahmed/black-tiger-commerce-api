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
