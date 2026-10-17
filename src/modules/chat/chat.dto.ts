/**
 * Request DTOs for Ask AI session and message endpoints.
 *
 * Storefront → API: validated bodies for `POST /v1/chat/sessions` and
 * `POST /v1/chat/messages` (message length capped for abuse protection).
 */
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}

export class ChatSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
