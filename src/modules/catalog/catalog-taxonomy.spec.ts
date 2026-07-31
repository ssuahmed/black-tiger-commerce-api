import {
  buildCatalogFacets,
  matchesSegmentApplicationPairs,
  matchesTaxonomyFacet,
  normalizeViscosityKey,
  productViscosity,
  segmentApplicationValue,
} from './catalog-taxonomy';
import type { ProductFixture } from '../../mocks/catalog.fixtures';
import { PRODUCTS_BY_SLUG } from '../../mocks/catalog.fixtures';

describe('catalog-taxonomy', () => {
  const products = Object.values(PRODUCTS_BY_SLUG);

  it('normalizes viscosity keys', () => {
    expect(normalizeViscosityKey('5W30')).toBe('5w-30');
    expect(normalizeViscosityKey('10w-40')).toBe('10w-40');
    expect(normalizeViscosityKey(' 15W 40 ')).toBe('15w-40');
  });

  it('filters passenger-cars + petrol-engine together', () => {
    const filtered = products.filter(
      (p) =>
        matchesTaxonomyFacet(p, 'segment', ['passenger-cars']) &&
        matchesTaxonomyFacet(p, 'application', ['petrol-engine']),
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((p) => (p.applicationTags ?? []).includes('petrol-engine'))).toBe(
      true,
    );
  });

  it('filters product line and viscosity', () => {
    const filtered = products.filter(
      (p) =>
        matchesTaxonomyFacet(p, 'productLine', ['tiger_x']) &&
        matchesTaxonomyFacet(p, 'viscosity', ['5w-30']),
    );
    expect(filtered.map((p) => p.slug)).toContain('tiger-x-5w30-sn');
    expect(filtered.every((p) => productViscosity(p) === '5w-30')).toBe(true);
  });

  it('builds dynamic facet groups from catalog', () => {
    const facets = buildCatalogFacets(products);
    const keys = facets.map((f) => f.key);
    expect(keys).toEqual(['segment', 'productLine', 'viscosity']);
    const segment = facets.find((f) => f.key === 'segment');
    expect(segment?.options.some((o) => (o.children?.length ?? 0) > 0)).toBe(true);
  });

  it('scopes application pairs to their own segment', () => {
    const pair = segmentApplicationValue('commercial', 'petrol-engine');
    const matched = products.filter((p) => matchesSegmentApplicationPairs(p, [pair]));
    expect(matched.length).toBeGreaterThan(0);
    for (const p of matched) {
      expect(p.segmentTags ?? []).toContain('commercial');
      expect(p.applicationTags ?? []).toContain('petrol-engine');
    }

    // Passenger-only petrol products must not leak into the commercial pair.
    const passengerOnlyPetrol = products.filter(
      (p) =>
        (p.applicationTags ?? []).includes('petrol-engine') &&
        !(p.segmentTags ?? []).includes('commercial'),
    );
    expect(passengerOnlyPetrol.length).toBeGreaterThan(0);
    for (const p of passengerOnlyPetrol) {
      expect(matched).not.toContain(p);
    }
  });

  it('uses pairs through matchesTaxonomyFacet', () => {
    const pair = segmentApplicationValue('passenger-cars', 'hybrid');
    const matched = products.filter((p) =>
      matchesTaxonomyFacet(p, 'segmentApplication', [pair]),
    );
    expect(matched.map((p) => p.slug)).toEqual(['tiger-x-5w30-sn']);
  });

  it('emits segment-scoped child facet values', () => {
    const facets = buildCatalogFacets(products);
    const segment = facets.find((f) => f.key === 'segment');
    const commercial = segment?.options.find((o) => o.value === 'commercial');
    const child = commercial?.children?.find((c) => c.label === 'Petrol Engine');
    expect(child?.key).toBe('segmentApplication');
    expect(child?.value).toBe('commercial:petrol-engine');
  });

  it('nests applications under each segment', () => {
    const facets = buildCatalogFacets(products);
    const segment = facets.find((f) => f.key === 'segment');
    const passenger = segment?.options.find((o) => o.value === 'passenger-cars');
    const commercial = segment?.options.find((o) => o.value === 'commercial');
    const passengerApps = new Set((passenger?.children ?? []).map((c) => c.application));
    const commercialApps = new Set((commercial?.children ?? []).map((c) => c.application));
    expect(passengerApps.has('petrol-engine')).toBe(true);
    expect(passengerApps.has('hybrid')).toBe(true);
    expect(commercialApps.has('diesel-engine')).toBe(true);
    if (commercialApps.has('transmission')) {
      expect(passengerApps.has('transmission')).toBe(false);
    }
  });

  it('returns all products when no taxonomy filters applied', () => {
    const identity = (p: ProductFixture) =>
      matchesTaxonomyFacet(p, 'segment', []) &&
      matchesTaxonomyFacet(p, 'application', []) &&
      matchesTaxonomyFacet(p, 'productLine', []) &&
      matchesTaxonomyFacet(p, 'viscosity', []);
    expect(products.every(identity)).toBe(true);
  });
});
