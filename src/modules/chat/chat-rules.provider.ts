import { Injectable } from '@nestjs/common';
import {
  productToCard,
  type ProductFixture,
} from '../../mocks/catalog.fixtures';
import { inferChatIntent, productMatchesIntent } from './chat-intent';
import type { ChatProductCard } from './chat.types';

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

    const intent = inferChatIntent(text);
    const ar = intent.language === 'ar';
    const greeting =
      /^(hi|hello|hey|thanks|thank you|ok|okay|مرحبا|السلام|اهلا|أهلا)\b/i.test(text) ||
      text.length < 8;
    if (greeting && !intent.wantsRecommendation) {
      return {
        reply: ar
          ? 'مرحبا — يمكنني مساعدتك في اختيار زيت بلاك تايجر المناسب. ما نوع المركبة أو المعدات، وهل تعرف درجة اللزوجة (مثل 5W-30)؟'
          : 'Hi — I can help you pick the right Black Tiger lubricant. What vehicle or equipment is it for, and do you know the viscosity (for example 5W-30)?',
        products: [],
      };
    }

    let matches = products.filter((p) => productMatchesIntent(p, intent));

    if (!intent.viscosityNeedles.length && !intent.segmentSlugs.length) {
      const tokens = text
        .toLowerCase()
        .split(/[^a-z0-9\u0600-\u06FF]+/i)
        .filter((t) => t.length >= 3);
      matches = products.filter((p) => {
        const hay =
          `${p.name} ${p.productCode} ${p.slug} ${p.shortDescription ?? ''} ${p.viscosity ?? ''} ${(p.segmentTags ?? []).join(' ')} ${(p.applicationTags ?? []).join(' ')}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
    }

    if (!intent.wantsRecommendation && !matches.length) {
      return {
        reply: ar
          ? 'يمكنني التضييق أكثر — هل هي سيارة ركاب، ديزل تجاري، أم استخدام صناعي؟ وهل لديك تفضيل لدرجة اللزوجة؟'
          : 'I can narrow this down — is it a passenger car, commercial diesel, or industrial use? Any viscosity preference?',
        products: [],
      };
    }

    if (!matches.length) {
      return {
        reply: ar
          ? 'لم أجد زيتاً مطابقاً بعد. أخبرني إن كانت بنزين أو ديزل أو درجة اللزوجة وسأقترح من الكتالوج.'
          : 'I could not find a matching lubricant yet. Share petrol vs diesel or a viscosity grade and I’ll suggest products from the catalog.',
        products: [],
      };
    }

    const picked = matches.slice(0, Math.min(limit, 3));
    const parts: string[] = [];
    if (intent.vehicleLabel) parts.push(intent.vehicleLabel);
    if (intent.viscosityLabels.length) parts.push(intent.viscosityLabels.join('/'));
    if (intent.segmentSlugs.includes('passenger-cars')) {
      parts.push(ar ? 'سيارات الركاب' : 'passenger cars');
    } else if (intent.segmentSlugs.includes('commercial')) {
      parts.push(ar ? 'المركبات التجارية' : 'commercial vehicles');
    } else if (intent.segmentSlugs.includes('industrial')) {
      parts.push(ar ? 'الاستخدام الصناعي' : 'industrial use');
    }
    const focus = parts.length ? parts.join(ar ? ' · ' : ' · ') : ar ? 'طلبك' : 'your request';

    const vehicleNote = intent.vehicleLabel
      ? ar
        ? ` لمركبة ${intent.vehicleLabel}، زيوت محركات البنزين لسيارات الركاب من كتالوجنا نقطة بداية جيدة.`
        : ` For a ${intent.vehicleLabel}, passenger petrol engine oils from our catalog are a good starting point.`
      : '';

    return {
      reply: ar
        ? `بناءً على ${focus}، إليك ${picked.length} اقتراح(ات) من الكتالوج.${vehicleNote}`
        : `Based on ${focus}, here are ${picked.length} product suggestion(s) from our catalog.${vehicleNote}`,
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
