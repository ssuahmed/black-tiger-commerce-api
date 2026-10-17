/**
 * LLM-backed Ask AI recommender with automatic rules fallback.
 *
 * Storefront → API → OpenAI-compatible LLM (optional): when `CHAT_PROVIDER=llm`,
 * retrieves a catalog slice via intent scoring, prompts the model for JSON
 * `{reply, slugs}`, then maps slugs to product cards. On any failure (or when
 * provider is `rules`), delegates to ChatRulesProvider — catalog may be Odoo-backed.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  productToCard,
  type ProductFixture,
} from '../../mocks/catalog.fixtures';
import {
  formatIntentHint,
  selectProductsForChat,
  type ChatIntent,
} from './chat-intent';
import type { ChatProductCard, ChatTurn } from './chat.types';
import { ChatRulesProvider } from './chat-rules.provider';

const SYSTEM_PROMPT = `You are Black Tiger Ask AI — a helpful lubricants advisor for Black Tiger products in Saudi Arabia.

Hard rules (unchanged product safety):
- ONLY discuss and recommend products / viscosity grades that appear in the catalog list you are given.
- NEVER invent grades (for example do not suggest 10W-40 or 10W-50 unless those exact grades are in the catalog).
- Never invent product slugs — copy slugs exactly from the catalog list.
- Keep replies concise. The "reply" value must be plain shopper text — never include the words reply: or slugs: or raw JSON.

Vehicle / use-case rules (important):
- Shoppers often name a vehicle (make/model/year). The catalog lists lubricants, NOT vehicles.
- NEVER say a vehicle (e.g. Ford Mustang) is "not in the catalog" or that you lack information on that vehicle.
- Instead, infer the use-case: light passenger / sports cars → passenger-cars + petrol-engine oils; commercial trucks → commercial + diesel; etc.
- When the use-case is clear, recommend suitable catalog products and briefly explain why (segment, viscosity, application).
- Ask petrol vs diesel or viscosity only if truly needed to choose among catalog options.
- Prefer recommending products when the shopper states a clear need (e.g. "engine oil for my Mustang").

Conversation rules:
- Answer the shopper's question clearly and helpfully in natural language.
- Prefer a natural chat. Do NOT recommend products on every greeting-only message.
- If the question is not about lubricants/products, answer briefly and steer back to Black Tiger catalog help.
- If no catalog product fits the inferred use-case, say you could not find a matching lubricant and ask one clarifying question.
- LANGUAGE (mandatory): Write the entire "reply" in the same language as the shopper's latest message.
  - Arabic script → reply fully in Arabic (Modern Standard Arabic is fine).
  - English → reply in English.
  - Mixed (e.g. Arabic + English brand names) → reply in the shopper's dominant language; keep product names/grades as written in the catalog.
  - Never answer Arabic questions in English (or the reverse) unless the shopper explicitly asks to switch.
- Viscosity grades (5W-30), product names, and slugs may stay in Latin script even inside Arabic replies.

Output format (mandatory):
Return ONE valid JSON object and nothing else:
{"reply":"shopper-facing text only","slugs":["exact-catalog-slug"]}
Use "slugs":[] when no product cards are needed.`;

@Injectable()
export class ChatLlmProvider {
  private readonly logger = new Logger(ChatLlmProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly rules: ChatRulesProvider,
  ) {}

  /** True when `CHAT_PROVIDER=llm` (otherwise rules-only). */
  enabled(): boolean {
    return (this.config.get<string>('CHAT_PROVIDER') ?? 'rules').toLowerCase() === 'llm';
  }

  /** Produce a shopper reply + product cards; fall back to rules on LLM failure. */
  async recommend(
    message: string,
    products: ProductFixture[],
    limit = 4,
    history: ChatTurn[] = [],
  ): Promise<{ reply: string; products: ChatProductCard[]; provider: 'rules' | 'llm' }> {
    if (!this.enabled()) {
      const result = this.rules.recommend(message, products, limit);
      return { ...result, provider: 'rules' };
    }

    try {
      // Intent-ranked catalog slice keeps the prompt small and on-policy.
      const { intent, slice: catalog } = selectProductsForChat(message, products, 30);
      const llm = await this.callLlm(message, catalog, history, intent);
      if (!llm) {
        throw new Error('Empty LLM response');
      }
      // Only emit cards for slugs that exist in the full catalog (never invent SKUs).
      const bySlug = new Map(products.map((p) => [p.slug, p]));
      const allowedSlugs = new Set(products.map((p) => p.slug));
      const cards = (llm.slugs ?? [])
        .filter((slug) => allowedSlugs.has(slug))
        .map((slug) => bySlug.get(slug))
        .filter(Boolean)
        .slice(0, Math.min(limit, 3))
        .map((p) => this.toCard(productToCard(p as ProductFixture)));

      return {
        reply: this.sanitizeReply(llm.reply) ||
          (cards.length
            ? 'Here are products that may fit your need.'
            : 'Tell me a bit more — petrol or diesel, and preferred viscosity if you know it.'),
        products: cards,
        provider: 'llm',
      };
    } catch (err) {
      this.logger.warn(
        `LLM chat failed, falling back to rules: ${err instanceof Error ? err.message : String(err)}`,
      );
      const result = this.rules.recommend(message, products, limit);
      return { ...result, provider: 'rules' };
    }
  }

  private formatCatalogLine(p: ProductFixture): string {
    const specs = (p.specifications ?? []).slice(0, 4).join('; ');
    const benefits = (p.benefits ?? []).slice(0, 3).join('; ');
    const tags = (p.segmentTags ?? []).join(',');
    const apps = (p.applicationTags ?? []).join(',');
    const desc = (p.shortDescription || p.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const parts = [
      `slug=${p.slug}`,
      `name=${p.name}`,
      `code=${p.productCode}`,
      `category=${p.categorySlug}`,
      p.viscosity ? `viscosity=${p.viscosity}` : '',
      tags ? `segments=${tags}` : '',
      apps ? `applications=${apps}` : '',
      p.productLine ? `line=${p.productLine}` : '',
      desc ? `desc=${desc}` : '',
      specs ? `specs=${specs}` : '',
      benefits ? `benefits=${benefits}` : '',
      `price=${p.unitPrice} ${p.currency}`,
      p.inStock ? 'inStock' : 'outOfStock',
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  }

  // Ollama often lacks response_format=json_object; disable unless explicitly forced.
  private useJsonResponseFormat(): boolean {
    const raw = (this.config.get<string>('CHAT_LLM_JSON_MODE') ?? '').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    const base = (this.config.get<string>('CHAT_LLM_BASE_URL') || '').toLowerCase();
    if (base.includes('11434') || base.includes('ollama')) return false;
    return true;
  }

  // OpenAI-compatible /chat/completions with catalog + intent hints in system messages.
  private async callLlm(
    message: string,
    catalog: ProductFixture[],
    history: ChatTurn[],
    intent: ChatIntent,
  ): Promise<{ reply: string; slugs: string[] } | null> {
    const apiKey = this.config.get<string>('CHAT_LLM_API_KEY')?.trim() || 'ollama';
    const baseUrl = (
      this.config.get<string>('CHAT_LLM_BASE_URL') || 'http://localhost:11434/v1'
    ).replace(/\/$/, '');
    const model = this.config.get<string>('CHAT_LLM_MODEL') || 'llama3.2:3b';

    const catalogBlock = catalog.map((p) => this.formatCatalogLine(p)).join('\n');
    const grades = this.catalogGrades(catalog);
    const intentHint = formatIntentHint(intent);
    const prior = history
      .slice(-6)
      .filter((t) => t.content?.trim())
      .map((t) => ({
        role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: t.content.slice(0, 1200),
      }));

    const body: Record<string, unknown> = {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'system',
          content: [
            `Allowed viscosity grades in this catalog ONLY: ${grades.join(', ') || 'see product lines'}.`,
            'Do not mention any other viscosity grade.',
            intentHint ? `Retrieval hint: ${intentHint}` : '',
            'Black Tiger catalog (slugs must be copied exactly from these lines):',
            catalogBlock,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        ...prior,
        {
          role: 'user',
          content: [
            message,
            '',
            intent.language === 'ar'
              ? 'Respond in Arabic. Return ONLY valid JSON like {"reply":"...","slugs":[]}. Plain text inside reply. Only use catalog grades/slugs. If a vehicle was named, recommend matching lubricants — never claim the vehicle is missing from the catalog.'
              : 'Respond in English. Return ONLY valid JSON like {"reply":"...","slugs":[]}. Plain text inside reply. Only use catalog grades/slugs. If a vehicle was named, recommend matching lubricants — never claim the vehicle is missing from the catalog.',
          ].join('\n'),
        },
      ],
    };
    if (this.useJsonResponseFormat()) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    return this.parseLlmJson(content);
  }

  // Tolerate fenced / loose JSON common from local models; never throw to the shopper.
  private parseLlmJson(content: string): { reply: string; slugs: string[] } {
    const trimmed = content.trim();
    const candidates = [trimmed];
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) candidates.unshift(fence[1].trim());
    const brace = trimmed.match(/\{[\s\S]*\}/);
    if (brace?.[0]) candidates.unshift(brace[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as { reply?: string; slugs?: unknown };
        return {
          reply: this.sanitizeReply(String(parsed.reply ?? '')),
          slugs: Array.isArray(parsed.slugs) ? parsed.slugs.map(String) : [],
        };
      } catch {
        /* try next */
      }
      const repaired = this.tryRepairLooseJson(candidate);
      if (repaired) return repaired;
    }

    const loose = this.tryRepairLooseJson(trimmed);
    if (loose) return loose;

    this.logger.warn('LLM returned non-JSON; using sanitized raw text as reply');
    return { reply: this.sanitizeReply(trimmed), slugs: [] };
  }

  private tryRepairLooseJson(raw: string): { reply: string; slugs: string[] } | null {
    const replyMatch =
      raw.match(/["']?reply["']?\s*[:=]\s*["']([\s\S]*?)["']\s*(?:,|\n|["']?slugs|$)/i) ||
      raw.match(/["']?reply["']?\s*[:=]\s*["']([\s\S]*?)["']\s*$/i);
    if (!replyMatch?.[1]) return null;
    const slugsMatch = raw.match(/["']?slugs["']?\s*[:=]\s*\[([^\]]*)\]/i);
    const slugs = slugsMatch?.[1]
      ? slugsMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : [];
    return { reply: this.sanitizeReply(replyMatch[1]), slugs };
  }

  private sanitizeReply(text: string): string {
    let out = String(text ?? '').trim();
    if (!out) return '';
    out = out.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    if (/^\s*\{[\s\S]*\}\s*$/.test(out)) {
      try {
        const parsed = JSON.parse(out) as { reply?: string };
        if (parsed.reply) out = String(parsed.reply);
      } catch {
        const m = out.match(/["']?reply["']?\s*[:=]\s*["']([\s\S]*?)["']/i);
        if (m?.[1]) out = m[1];
      }
    }
    out = out
      .replace(/^\s*\{?\s*["']?reply["']?\s*[:=]\s*["']?/i, '')
      .replace(/["']?\s*,?\s*["']?slugs["']?\s*[:=]\s*\[[^\]]*\]\s*\}?\s*$/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    return out;
  }

  private catalogGrades(products: ProductFixture[]): string[] {
    const found = new Set<string>();
    const re = /(\d+)\s*w\s*[- ]?\s*(\d+)/gi;
    for (const p of products) {
      const hay = `${p.slug} ${p.name} ${p.shortDescription ?? ''} ${p.viscosity ?? ''}`;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(hay))) {
        found.add(`${m[1]}W-${m[2]}`);
      }
    }
    return [...found].sort();
  }

  private toCard(card: Record<string, unknown>): ChatProductCard {
    const image =
      card.image && typeof card.image === 'object'
        ? (card.image as { url?: string; alt?: string })
        : undefined;
    const price =
      card.price && typeof card.price === 'object'
        ? (card.price as { formatted?: string; amount?: number; currency?: string })
        : undefined;
    return {
      slug: String(card.slug ?? ''),
      name: String(card.name ?? card.slug ?? ''),
      productCode: card.productCode ? String(card.productCode) : undefined,
      categoryLabel: card.categoryLabel ? String(card.categoryLabel) : undefined,
      image: image?.url ? { url: image.url, alt: image.alt } : undefined,
      price,
      viewHref: card.viewHref ? String(card.viewHref) : undefined,
      badges: Array.isArray(card.badges) ? (card.badges as string[]) : undefined,
    };
  }
}
