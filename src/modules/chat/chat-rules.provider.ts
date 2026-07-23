import { Injectable } from '@nestjs/common';
import {
  productToCard,
  type ProductFixture,
} from '../../mocks/catalog.fixtures';
import type { ChatProductCard } from './chat.types';

const VISCOSITY_PATTERNS: Array<{ re: RegExp; label: string; needles: string[] }> = [
  { re: /10\s*w\s*[- ]?\s*30|10w30/i, label: '10W-30', needles: ['10w30'] },
  { re: /5\s*w\s*[- ]?\s*30|5w30/i, label: '5W-30', needles: ['5w30'] },
  { re: /15\s*w\s*[- ]?\s*40|15w40/i, label: '15W-40', needles: ['15w40'] },
  { re: /20\s*w\s*[- ]?\s*50|20w50/i, label: '20W-50', needles: ['20w50'] },
];

const SEGMENT_PATTERNS: Array<{ re: RegExp; slug: string; label: string }> = [
  {
    re: /passenger|car|petrol|gasoline|sedan/i,
    slug: 'passenger-cars',
    label: 'passenger cars',
  },
  {
    re: /commercial|truck|diesel|fleet|heavy/i,
    slug: 'commercial',
    label: 'commercial vehicles',
  },
  {
    re: /industrial|hydraulic|gear|machine/i,
    slug: 'industrial',
    label: 'industrial',
  },
];

@Injectable()
export class ChatRulesProvider {
  recommend(
    message: string,
    products: ProductFixture[],
    limit = 4,
  ): { reply: string; products: ChatProductCard[] } {
    const text = message.trim();
    if (!text) {
      return {
        reply: 'Tell me what you need — viscosity (e.g. 10W-30), vehicle type, or a product name.',
        products: [],
      };
    }

    const viscosity = VISCOSITY_PATTERNS.find((p) => p.re.test(text));
    const segment = SEGMENT_PATTERNS.find((p) => p.re.test(text));
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length >= 3);

    const greeting =
      /^(hi|hello|hey|thanks|thank you|ok|okay|مرحبا|السلام)\b/i.test(text) ||
      text.length < 8;
    if (greeting && !viscosity && !segment) {
      return {
        reply:
          'Hi — I can help you pick the right Black Tiger lubricant. What vehicle or equipment is it for, and do you know the viscosity (for example 5W-30)?',
        products: [],
      };
    }

    let matches = products.filter((p) => {
      if (viscosity && !viscosity.needles.some((n) => p.slug.includes(n))) {
        return false;
      }
      if (segment) {
        const tags = p.segmentTags ?? [];
        const ok =
          p.categorySlug === segment.slug ||
          p.categorySlug.includes(segment.slug) ||
          tags.includes(segment.slug);
        if (!ok) return false;
      }
      return true;
    });

    if (!viscosity && !segment) {
      matches = products.filter((p) => {
        const hay = `${p.name} ${p.productCode} ${p.slug} ${p.shortDescription ?? ''}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
    }

    const wantsProducts =
      /recommend|suggest|show|product|which oil|what oil|need oil|looking for/i.test(text) ||
      Boolean(viscosity) ||
      Boolean(segment) ||
      matches.length > 0;

    if (!wantsProducts || (!viscosity && !segment && !matches.length)) {
      return {
        reply:
          'I can narrow this down — is it a passenger car, commercial diesel, or industrial use? Any viscosity preference?',
        products: [],
      };
    }

    if (!matches.length) {
      return {
        reply:
          'I could not find an exact match yet. Share the viscosity grade or vehicle type and I’ll suggest products.',
        products: [],
      };
    }

    const picked = matches.slice(0, Math.min(limit, 3));
    const parts: string[] = [];
    if (viscosity) parts.push(viscosity.label);
    if (segment) parts.push(segment.label);
    const focus = parts.length ? parts.join(' for ') : 'your request';
    return {
      reply: `Based on ${focus}, here are ${picked.length} product suggestion(s) from our catalog.`,
      products: picked.map((p) => this.toCard(productToCard(p))),
    };
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
