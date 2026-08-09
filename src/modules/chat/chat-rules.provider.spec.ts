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
      segmentTags: ['passenger-cars'],
      applicationTags: ['petrol-engine'],
      viscosity: '10w-30',
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
      applicationTags: ['diesel-engine'],
      viscosity: '15w-40',
    },
  ] as unknown as ProductFixture[];

  it('matches viscosity keywords', () => {
    const result = provider.recommend('Need 10W-30 for my car', products);
    expect(result.products.some((p) => p.slug.includes('10w30'))).toBe(true);
    expect(result.reply).toMatch(/10W-30/i);
  });

  it('matches commercial segment', () => {
    const result = provider.recommend('oil for diesel truck fleet', products);
    expect(result.products[0]?.slug).toContain('15w40');
  });

  it('maps Ford Mustang engine-oil queries to passenger oils', () => {
    const result = provider.recommend(
      'I am looking for engine oil for my ford mustang 2023',
      products,
    );
    expect(result.products.some((p) => p.slug.includes('10w30'))).toBe(true);
    expect(result.reply).not.toMatch(/not in (our )?catalog|don't have information/i);
    expect(result.reply).toMatch(/mustang|passenger/i);
  });

  it('returns fallback when empty message', () => {
    const result = provider.recommend('   ', products);
    expect(result.products).toHaveLength(0);
    expect(result.reply).toMatch(/Tell me/i);
  });
});
