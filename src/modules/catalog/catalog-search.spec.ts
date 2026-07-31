import { matchesSearchQuery } from './catalog.service';
import type { ProductFixture } from '../../mocks/catalog.fixtures';

function sample(overrides: Partial<ProductFixture> = {}): ProductFixture {
  return {
    id: '1',
    slug: 'tiger-10w30-sl',
    name: 'TIGER 10W30 SL Fully Synthetic',
    productCode: 'PRODUCT 65518',
    categorySlug: 'engine-oils',
    categoryLabel: 'ENGINE OILS',
    segmentTags: ['passenger-cars'],
    imageUrl: 'https://example.com/x.png',
    unitPrice: 100,
    currency: 'SAR',
    inStock: true,
    packagingOptions: [],
    pricing: {},
    ...overrides,
  };
}

describe('matchesSearchQuery', () => {
  it('matches name substring', () => {
    expect(matchesSearchQuery(sample(), '10w30')).toBe(true);
  });

  it('matches product code', () => {
    expect(matchesSearchQuery(sample(), '65518')).toBe(true);
  });

  it('matches category label', () => {
    expect(matchesSearchQuery(sample(), 'engine')).toBe(true);
  });

  it('rejects non-matches', () => {
    expect(matchesSearchQuery(sample(), 'gearbox')).toBe(false);
  });

  it('empty query matches all', () => {
    expect(matchesSearchQuery(sample(), '   ')).toBe(true);
  });
});
