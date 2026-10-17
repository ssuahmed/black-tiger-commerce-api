/**
 * Ask AI session orchestration for the storefront chat widget.
 *
 * Storefront → API → (catalog snapshot / optional LLM): creates sessions, enforces
 * rate limits, loads the product catalog, delegates recommendation to ChatLlmProvider,
 * and persists short conversation turns in Redis (memory fallback). Does not call Odoo
 * directly — catalog data may already be Odoo-backed upstream.
 */
import { Injectable } from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import { RedisService } from '../../infrastructure/redis/redis.module';
import { CatalogProductsProvider } from '../catalog/catalog-products.provider';
import { ChatLlmProvider } from './chat-llm.provider';
import {
  ChatRateLimitService,
  type ChatIdentityKind,
  type ChatUsageSnapshot,
} from './chat-rate-limit.service';
import type { ChatMessageResult, ChatTurn } from './chat.types';

const SESSION_TTL_SEC = 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SEC * 1000;
const MAX_TURNS = 16;
const SESSION_KEY_PREFIX = 'bt:chat:session:';

type SessionState = {
  turns: ChatTurn[];
  updatedAt: number;
};

@Injectable()
export class ChatService {
  private readonly memorySessions = new Map<string, SessionState>();

  constructor(
    private readonly catalog: CatalogProductsProvider,
    private readonly llm: ChatLlmProvider,
    private readonly rateLimit: ChatRateLimitService,
    private readonly redis: RedisService,
  ) {}

  /** Allocate a new empty chat session id. */
  async createSession() {
    const sessionId = newId();
    await this.saveSession(sessionId, { turns: [], updatedAt: Date.now() });
    return { sessionId };
  }

  /** Rate-limit, recommend products for the message, and append the turn to the session. */
  async postMessage(input: {
    message: string;
    sessionId?: string;
    userId?: string;
    clientIp?: string;
  }): Promise<ChatMessageResult & { usage: ChatUsageSnapshot }> {
    this.pruneMemorySessions();
    // Authenticated users share a user quota; guests are keyed by client IP.
    const { identity, subject } = this.resolveSubject(input.userId, input.clientIp);
    const usage = await this.rateLimit.consume(identity, subject);

    const sessionId = input.sessionId?.trim() || newId();
    const session = (await this.loadSession(sessionId)) ?? {
      turns: [],
      updatedAt: Date.now(),
    };

    const snapshot = await this.catalog.getSnapshot();
    const products = Object.values(snapshot.productsBySlug);
    const history = session.turns.slice(-MAX_TURNS);
    const result = await this.llm.recommend(input.message, products, 4, history);

    const nextTurns: ChatTurn[] = [
      ...history,
      { role: 'user' as const, content: input.message },
      { role: 'assistant' as const, content: result.reply },
    ].slice(-MAX_TURNS);

    await this.saveSession(sessionId, { turns: nextTurns, updatedAt: Date.now() });

    return {
      sessionId,
      reply: result.reply,
      products: result.products,
      provider: result.provider,
      usage,
    };
  }

  private resolveSubject(
    userId?: string,
    clientIp?: string,
  ): { identity: ChatIdentityKind; subject: string } {
    const uid = userId?.trim();
    if (uid) {
      return { identity: 'user', subject: uid };
    }
    const ip = (clientIp || 'unknown').trim() || 'unknown';
    return { identity: 'guest', subject: ip };
  }

  // Prefer Redis session; fall back to in-process map.
  private async loadSession(sessionId: string): Promise<SessionState | null> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(`${SESSION_KEY_PREFIX}${sessionId}`);
      if (raw) {
        try {
          return JSON.parse(raw) as SessionState;
        } catch {
          return null;
        }
      }
    }
    return this.memorySessions.get(sessionId) ?? null;
  }

  private async saveSession(sessionId: string, state: SessionState): Promise<void> {
    if (this.redis.enabled) {
      const ok = await this.redis.setex(
        `${SESSION_KEY_PREFIX}${sessionId}`,
        SESSION_TTL_SEC,
        JSON.stringify(state),
      );
      if (ok) return;
    }
    this.memorySessions.set(sessionId, state);
  }

  private pruneMemorySessions() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, state] of this.memorySessions) {
      if (state.updatedAt < cutoff) this.memorySessions.delete(id);
    }
  }
}
