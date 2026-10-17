/**
 * Intent inference and catalog retrieval helpers for Ask AI.
 *
 * Storefront → API → catalog: maps free-text (vehicles, viscosity, fuel) onto
 * segment/application tags so both the rules engine and LLM prompt receive a
 * focused product slice. Vehicles are use-cases, not SKUs.
 */
import type { ProductFixture } from '../../mocks/catalog.fixtures';

export type ChatFuelHint = 'petrol' | 'diesel' | 'unknown';
export type ChatReplyLanguage = 'ar' | 'en';

export type ChatIntent = {
  wantsRecommendation: boolean;
  viscosityLabels: string[];
  viscosityNeedles: string[];
  segmentSlugs: string[];
  applicationTags: string[];
  fuel: ChatFuelHint;
  vehicleLabel: string | null;
  /** Reply language inferred from the shopper message. */
  language: ChatReplyLanguage;
  /** Extra retrieval tokens derived from intent (not raw user tokens). */
  boostTokens: string[];
};

const VISCOSITY_PATTERNS: Array<{ re: RegExp; label: string; needles: string[] }> = [
  { re: /0\s*w\s*[- ]?\s*20|0w20/i, label: '0W-20', needles: ['0w20', '0w-20'] },
  { re: /5\s*w\s*[- ]?\s*20|5w20/i, label: '5W-20', needles: ['5w20', '5w-20'] },
  { re: /5\s*w\s*[- ]?\s*30|5w30/i, label: '5W-30', needles: ['5w30', '5w-30'] },
  { re: /5\s*w\s*[- ]?\s*40|5w40/i, label: '5W-40', needles: ['5w40', '5w-40'] },
  { re: /10\s*w\s*[- ]?\s*30|10w30/i, label: '10W-30', needles: ['10w30', '10w-30'] },
  { re: /10\s*w\s*[- ]?\s*40|10w40/i, label: '10W-40', needles: ['10w40', '10w-40'] },
  { re: /15\s*w\s*[- ]?\s*40|15w40/i, label: '15W-40', needles: ['15w40', '15w-40'] },
  { re: /20\s*w\s*[- ]?\s*50|20w50/i, label: '20W-50', needles: ['20w50', '20w-50'] },
];

/** Common light passenger vehicles → passenger petrol oils unless diesel is stated. */
const PASSENGER_VEHICLE_RE =
  /\b(mustang|camaro|corvette|camry|corolla|civic|accord|altima|sentra|elantra|sonata|tucson|sportage|rav4?|highlander|prado|land\s*cruiser|hilux|fortuner|pajero|outlander|cx[- ]?[35]|mazda\s*[36]|f[- ]?150|ranger|silverado|sierra|tahoe|yukon|explorer|edge|escape|focus|fiesta|fusion|taurus|charger|challenger|durango|wrangler|cherokee|compass|golf|passat|jetta|tiguan|polo|octavia|superb|yaris|vitz|sunny|patrol|x[- ]?trail|pathfinder|armada|navara|d[- ]?max|amarok|amarok|bmw|mercedes|benz|audi|lexus|infiniti|genesis|porsche|ferrari|lamborghini|bentley|rolls|mini|volvo|jaguar|land\s*rover|range\s*rover|tesla|byd|geely|changan|haval|mg\b|toyota|honda|nissan|hyundai|kia|ford|chevrolet|chevy|gmc|dodge|jeep|volkswagen|vw|skoda|mazda|mitsubishi|suzuki|subaru|peugeot|renault|fiat)\b/i;

const COMMERCIAL_VEHICLE_RE =
  /\b(truck|lorry|trailer|semi|fleet|bus|coach|dump\s*truck|tipper|tanker|excavator|loader|bulldozer|crane|generator|heavy\s*duty|commercial\s*diesel|freight)\b/i;

const INDUSTRIAL_RE =
  /\b(hydraulic|industrial|gear\s*oil|compressor|machine\s*tool|plant\s*equipment|cnc)\b/i;

const ENGINE_OIL_RE =
  /\b(engine\s*oil|motor\s*oil|lubricant|lube|oil\s*for|looking\s*for.*oil|need.*oil|recommend.*oil|which\s*oil|what\s*oil)\b/i;

const DIESEL_RE = /\b(diesel|tdi|cdi|hdi|dci|crdi|tdci|multijet|powerstroke|duramax|cummins)\b/i;
const PETROL_RE =
  /\b(petrol|gasoline|gas\s*engine|gdi|tfs[i]?|ecoboost|skyactiv|vvt|hybrid|phev|petrol\s*engine)\b/i;

/** Detect reply language from the shopper message (Arabic script vs Latin). */
export function detectReplyLanguage(message: string): ChatReplyLanguage {
  const text = String(message || '');
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (arabicChars >= 2 && arabicChars >= latinChars * 0.35) return 'ar';
  return 'en';
}

/**
 * Infer shopper intent for retrieval + prompting.
 * Vehicle make/model/year is mapped to catalog segments — not treated as a SKU lookup.
 */
export function inferChatIntent(message: string): ChatIntent {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  const viscosityLabels: string[] = [];
  const viscosityNeedles: string[] = [];
  for (const v of VISCOSITY_PATTERNS) {
    if (v.re.test(text)) {
      viscosityLabels.push(v.label);
      viscosityNeedles.push(...v.needles);
    }
  }

  let fuel: ChatFuelHint = 'unknown';
  if (DIESEL_RE.test(text) && !PETROL_RE.test(text)) fuel = 'diesel';
  else if (PETROL_RE.test(text) && !DIESEL_RE.test(text)) fuel = 'petrol';
  else if (DIESEL_RE.test(text) && PETROL_RE.test(text)) fuel = 'unknown';

  const segmentSlugs: string[] = [];
  const applicationTags: string[] = [];
  const boostTokens: string[] = [];
  let vehicleLabel: string | null = null;

  const passengerHits = [...text.matchAll(new RegExp(PASSENGER_VEHICLE_RE.source, 'gi'))].map(
    (m) => String(m[1] || m[0]).replace(/\s+/g, ' ').trim(),
  );
  // Prefer specific models (mustang) over brand-only hits (ford) when both appear.
  const passengerHit =
    passengerHits.sort((a, b) => b.length - a.length)[0] || null;
  if (passengerHit) {
    vehicleLabel = passengerHit;
    segmentSlugs.push('passenger-cars');
    boostTokens.push('passenger', 'engine', 'oil', 'motor');
    if (fuel === 'diesel') {
      applicationTags.push('diesel-engine');
      boostTokens.push('diesel');
    } else {
      // Default light passenger cars (Mustang, Camry, etc.) toward petrol engine oils.
      applicationTags.push('petrol-engine');
      boostTokens.push('petrol', 'gasoline');
      if (fuel === 'unknown') fuel = 'petrol';
    }
  }

  if (COMMERCIAL_VEHICLE_RE.test(text)) {
    segmentSlugs.push('commercial');
    applicationTags.push('diesel-engine');
    boostTokens.push('commercial', 'diesel', 'truck');
    if (fuel === 'unknown') fuel = 'diesel';
  }

  if (INDUSTRIAL_RE.test(text)) {
    segmentSlugs.push('industrial');
    boostTokens.push('industrial', 'hydraulic', 'gear');
  }

  if (/passenger|car\b|sedan|suv|crossover|gasoline/i.test(text)) {
    if (!segmentSlugs.includes('passenger-cars')) segmentSlugs.push('passenger-cars');
    boostTokens.push('passenger');
  }

  if (ENGINE_OIL_RE.test(text) || passengerHit || /engine|motor/i.test(text)) {
    boostTokens.push('engine', 'oil');
    if (!applicationTags.length && fuel === 'petrol') applicationTags.push('petrol-engine');
    if (!applicationTags.length && fuel === 'diesel') applicationTags.push('diesel-engine');
  }

  const wantsRecommendation =
    ENGINE_OIL_RE.test(text) ||
    Boolean(passengerHit) ||
    Boolean(viscosityLabels.length) ||
    Boolean(segmentSlugs.length) ||
    /recommend|suggest|show\s+me|looking\s+for|need\s+|which\s+|what\s+oil/i.test(lower);

  return {
    wantsRecommendation,
    viscosityLabels: [...new Set(viscosityLabels)],
    viscosityNeedles: [...new Set(viscosityNeedles.map((n) => n.toLowerCase()))],
    segmentSlugs: [...new Set(segmentSlugs)],
    applicationTags: [...new Set(applicationTags)],
    fuel,
    vehicleLabel,
    language: detectReplyLanguage(text),
    boostTokens: [...new Set(boostTokens.map((t) => t.toLowerCase()))],
  };
}

/** Hard filters: viscosity needles, segment slugs, and application tags must all pass when set. */
export function productMatchesIntent(
  product: ProductFixture,
  intent: ChatIntent,
): boolean {
  if (intent.viscosityNeedles.length) {
    const hay = `${product.slug} ${product.name} ${product.viscosity ?? ''}`.toLowerCase();
    const ok = intent.viscosityNeedles.some(
      (n) => hay.includes(n) || hay.includes(n.replace('-', '')),
    );
    if (!ok) return false;
  }

  if (intent.segmentSlugs.length) {
    const tags = product.segmentTags ?? [];
    const cat = String(product.categorySlug || '').toLowerCase();
    const ok = intent.segmentSlugs.some(
      (s) =>
        cat === s ||
        cat.includes(s) ||
        tags.some((t) => t === s || t.includes(s)),
    );
    if (!ok) return false;
  }

  if (intent.applicationTags.length) {
    const apps = product.applicationTags ?? [];
    if (apps.length) {
      const ok = intent.applicationTags.some((a) => apps.includes(a));
      if (!ok) return false;
    }
  }

  return true;
}

/** Soft ranking for LLM context selection (token hits + intent boosts). */
export function scoreProductForChat(
  product: ProductFixture,
  message: string,
  intent: ChatIntent,
): number {
  const tokens = message
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
  const allTokens = [...new Set([...tokens, ...intent.boostTokens])];

  const hay = [
    product.slug,
    product.name,
    product.productCode,
    product.categorySlug,
    product.categoryLabel,
    product.shortDescription,
    product.subtitle,
    product.viscosity,
    product.productLine,
    ...(product.segmentTags ?? []),
    ...(product.applicationTags ?? []),
    ...(product.specifications ?? []),
    ...(product.benefits ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const t of allTokens) {
    if (hay.includes(t)) score += t.length >= 4 ? 3 : 1;
  }

  if (intent.viscosityNeedles.some((n) => hay.includes(n) || hay.includes(n.replace('-', '')))) {
    score += 12;
  }
  if (
    intent.segmentSlugs.some((s) =>
      (product.segmentTags ?? []).includes(s) ||
      String(product.categorySlug || '').includes(s),
    )
  ) {
    score += 10;
  }
  if (intent.applicationTags.some((a) => (product.applicationTags ?? []).includes(a))) {
    score += 8;
  }
  if (productMatchesIntent(product, intent) && intent.wantsRecommendation) {
    score += 6;
  }

  return score;
}

/** Build a capped catalog slice for the LLM prompt, preferring intent matches. */
export function selectProductsForChat(
  message: string,
  products: ProductFixture[],
  max = 30,
): { intent: ChatIntent; slice: ProductFixture[] } {
  const intent = inferChatIntent(message);
  const scored = products.map((p) => ({
    p,
    score: scoreProductForChat(p, message, intent),
    matches: productMatchesIntent(p, intent),
  }));
  scored.sort((a, b) => b.score - a.score);

  const intentMatches = scored.filter((s) => s.matches).map((s) => s.p);
  if (intent.wantsRecommendation && intentMatches.length) {
    const top = intentMatches.slice(0, max);
    if (top.length >= Math.min(6, max) || products.length <= max) {
      return { intent, slice: products.length <= max ? preferIntentOrder(products, intentMatches) : top };
    }
    // Pad with non-matches so the model still sees breadth when few products match.
    const rest = scored.filter((s) => !s.matches).map((s) => s.p);
    return { intent, slice: [...top, ...rest].slice(0, max) };
  }

  if (products.length <= max) {
    return { intent, slice: products };
  }

  const matched = scored.filter((s) => s.score > 0).map((s) => s.p);
  if (matched.length >= Math.min(8, max)) {
    return { intent, slice: matched.slice(0, max) };
  }
  const rest = scored.filter((s) => s.score === 0).map((s) => s.p);
  return { intent, slice: [...matched, ...rest].slice(0, max) };
}

function preferIntentOrder(
  all: ProductFixture[],
  intentMatches: ProductFixture[],
): ProductFixture[] {
  const first = new Set(intentMatches.map((p) => p.slug));
  return [...intentMatches, ...all.filter((p) => !first.has(p.slug))];
}

/** Compact natural-language hint injected into the LLM system prompt. */
export function formatIntentHint(intent: ChatIntent): string {
  const bits: string[] = [];
  if (intent.language === 'ar') {
    bits.push('Shopper language: Arabic. Write the entire reply in Arabic.');
  } else {
    bits.push('Shopper language: English. Write the entire reply in English.');
  }
  if (intent.vehicleLabel) {
    bits.push(
      `Shopper mentioned vehicle "${intent.vehicleLabel}". The catalog does NOT list vehicles by make/model/year.`,
    );
    bits.push(
      'Map that vehicle to a use-case and recommend matching catalog lubricants (do not say the vehicle is missing from the catalog).',
    );
  }
  if (intent.segmentSlugs.length) {
    bits.push(`Inferred segment(s): ${intent.segmentSlugs.join(', ')}.`);
  }
  if (intent.applicationTags.length) {
    bits.push(`Inferred application(s): ${intent.applicationTags.join(', ')}.`);
  }
  if (intent.fuel !== 'unknown') {
    bits.push(`Inferred fuel: ${intent.fuel}.`);
  }
  if (intent.viscosityLabels.length) {
    bits.push(`Shopper asked for viscosity: ${intent.viscosityLabels.join(', ')}.`);
  }
  if (intent.wantsRecommendation) {
    bits.push(
      'This is a clear product use-case — recommend 1–3 matching catalog slugs unless critical details are missing.',
    );
  }
  return bits.join(' ');
}
