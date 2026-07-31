import type { ProductFixture } from '../../mocks/catalog.fixtures';

const PRODUCT_LINE_LABELS: Record<string, string> = {
  tiger_x: 'Tiger X',
  tiger_plus: 'Tiger Plus',
  tiger: 'Tiger',
  other: 'Other',
};

/** Normalize viscosity to storefront facet keys (e.g. 5w-30). */
export function normalizeViscosityKey(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const compact = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
  const m = compact.match(/(\d{1,2})w-?(\d{2})/);
  if (m) return `${m[1]}w-${m[2]}`;
  return compact || undefined;
}

export function inferViscosityFromSlug(slug: string): string | undefined {
  return normalizeViscosityKey(slug);
}

export function productViscosity(p: ProductFixture): string {
  return (
    normalizeViscosityKey(p.viscosity) ??
    inferViscosityFromSlug(p.slug) ??
    'other'
  );
}

export function productLineKey(p: ProductFixture): string | undefined {
  if (p.productLine) return String(p.productLine).trim();
  if (p.slug.includes('tiger-x')) return 'tiger_x';
  if (p.slug.includes('tiger-plus') || p.slug.includes('tiger_plus')) return 'tiger_plus';
  if (p.slug.startsWith('tiger-') || p.slug.includes('tiger-')) return 'tiger';
  return undefined;
}

export function productLineLabel(key: string): string {
  return PRODUCT_LINE_LABELS[key] ?? key
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function productSegmentKeys(p: ProductFixture): string[] {
  if (p.segmentTags?.length) {
    return p.segmentTags;
  }
  if (p.categorySlug === 'commercial') return ['commercial'];
  if (p.categorySlug === 'industrial') return ['industrial'];
  if (p.categorySlug.includes('passenger')) return ['passenger-cars'];
  return ['passenger-cars'];
}

export function productApplicationKeys(p: ProductFixture): string[] {
  return Array.isArray(p.applicationTags) ? p.applicationTags.filter(Boolean) : [];
}

export function humanizeFacetValue(value: string): string {
  return value
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Composite facet value linking one segment to one application. */
export const SEGMENT_APPLICATION_SEPARATOR = ':';

export function segmentApplicationValue(
  segment: string,
  application: string,
): string {
  return `${segment}${SEGMENT_APPLICATION_SEPARATOR}${application}`;
}

export function parseSegmentApplication(
  raw: string,
): { segment: string; application: string } | null {
  const idx = String(raw).indexOf(SEGMENT_APPLICATION_SEPARATOR);
  if (idx <= 0) return null;
  const segment = raw.slice(0, idx).trim();
  const application = raw.slice(idx + 1).trim();
  if (!segment || !application) return null;
  return { segment, application };
}

/**
 * A product matches when it satisfies BOTH sides of at least one pair, so
 * `passenger-cars:petrol-engine` never pulls in commercial petrol products.
 */
export function matchesSegmentApplicationPairs(
  p: ProductFixture,
  pairs: string[],
): boolean {
  if (pairs.length === 0) return true;
  const segments = productSegmentKeys(p);
  const applications = productApplicationKeys(p);
  return pairs.some((raw) => {
    const pair = parseSegmentApplication(raw);
    if (!pair) return false;
    return (
      segments.includes(pair.segment) && applications.includes(pair.application)
    );
  });
}

export function matchesTaxonomyFacet(
  p: ProductFixture,
  key: string,
  values: string[],
): boolean {
  if (values.length === 0) return true;

  if (key === 'segmentApplication') {
    return matchesSegmentApplicationPairs(p, values);
  }

  if (key === 'viscosity') {
    return values.includes(productViscosity(p));
  }
  if (key === 'segment') {
    const tags = productSegmentKeys(p);
    return values.some((v) => tags.includes(v));
  }
  if (key === 'application') {
    const tags = productApplicationKeys(p);
    if (!tags.length) return false;
    return values.some((v) => tags.includes(v));
  }
  if (key === 'productLine') {
    const line = productLineKey(p);
    return Boolean(line && values.includes(line));
  }
  return true;
}

export type CatalogFacetOptions = {
  /**
   * When set, Product line / Viscosity options are counted only from products
   * that match at least one of these segment keys.
   */
  activeSegments?: string[];
};

export function productMatchesSegments(
  p: ProductFixture,
  segments: string[],
): boolean {
  if (!segments.length) return true;
  return matchesTaxonomyFacet(p, 'segment', segments);
}

export function buildCatalogFacets(
  items: ProductFixture[],
  options: CatalogFacetOptions = {},
) {
  const activeSegments = (options.activeSegments ?? []).filter(Boolean);
  const viscosity = new Map<string, number>();
  const segment = new Map<string, number>();
  /** segmentKey → applicationKey → count */
  const appsBySegment = new Map<string, Map<string, number>>();
  const productLine = new Map<string, number>();

  for (const p of items) {
    const apps = productApplicationKeys(p);
    for (const seg of productSegmentKeys(p)) {
      segment.set(seg, (segment.get(seg) ?? 0) + 1);
      if (!appsBySegment.has(seg)) {
        appsBySegment.set(seg, new Map());
      }
      const appMap = appsBySegment.get(seg)!;
      for (const app of apps) {
        appMap.set(app, (appMap.get(app) ?? 0) + 1);
      }
    }

    const inActiveSegment = productMatchesSegments(p, activeSegments);
    if (!inActiveSegment) continue;

    const vis = productViscosity(p);
    viscosity.set(vis, (viscosity.get(vis) ?? 0) + 1);

    const line = productLineKey(p);
    if (line) {
      productLine.set(line, (productLine.get(line) ?? 0) + 1);
    }
  }

  return [
    {
      key: 'segment',
      label: 'Segment',
      collapsed: false,
      options: [...segment.entries()].map(([value, count]) => {
        const appMap = appsBySegment.get(value) ?? new Map();
        return {
          value,
          label: humanizeFacetValue(value),
          count,
          children: [...appMap.entries()].map(([appValue, appCount]) => ({
            key: 'segmentApplication',
            value: segmentApplicationValue(value, appValue),
            label: humanizeFacetValue(appValue),
            count: appCount,
            segment: value,
            application: appValue,
          })),
        };
      }),
    },
    {
      key: 'productLine',
      label: 'Product line',
      collapsed: false,
      options: [...productLine.entries()].map(([value, count]) => ({
        value,
        label: productLineLabel(value),
        count,
      })),
    },
    {
      key: 'viscosity',
      label: 'Viscosity (SAE)',
      collapsed: false,
      options: [...viscosity.entries()].map(([value, count]) => ({
        value,
        label: value.toUpperCase(),
        count,
      })),
    },
  ];
}
