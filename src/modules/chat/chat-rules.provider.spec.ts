import { ChatRulesProvider } from './chat-rules.provider';
import type { ProductFixture } from '../../mocks/catalog.fixtures';

describe('ChatRulesProvider', () => {
  const provider = new ChatRulesProvider();
  const products = [
    {
      slug: 'tiger-10w30-sl-fully-synthetic',
      name: 'TIGER 10W30 SL',
      productCode: 'BT-10W30',
      categorySlug: 'passenger-cars',
      categoryLabel: 'Passenger',
      currency: 'SAR',
      unitPrice: 88.5,
      inStock: true,
      packagingOptions: [],
    },
    {
      slug: 'tiger-15w40-ci4',
      name: 'TIGER 15W40 CI-4',
      productCode: 'BT-15W40',
      categorySlug: 'commercial',
      categoryLabel: 'Commercial',
      currency: 'SAR',
      unitPrice: 120,
      inStock: true,
      packagingOptions: [],
      segmentTags: ['commercial'],
    },
  ] as ProductFixture[];

  it('matches viscosity keywords', () => {
    const result = provider.recommend('Need 10W-30 for my car', products);
    expect(result.products.some((p) => p.slug.includes('10w30'))).toBe(true);
    expect(result.reply).toMatch(/10W-30/i);
  });

  it('matches commercial segment', () => {
    const result = provider.recommend('oil for diesel truck fleet', products);
    expect(result.products[0]?.slug).toContain('15w40');
  });

  it('returns fallback when empty message', () => {
    const result = provider.recommend('   ', products);
    expect(result.products).toHaveLength(0);
    expect(result.reply).toMatch(/Tell me/i);
  });
});
