import { inferChatIntent, selectProductsForChat } from './chat-intent';
import type { ProductFixture } from '../../mocks/catalog.fixtures';

describe('chat-intent', () => {
  const products = [
    {
      slug: 'tiger-10w30-sl-fully-synthetic',
      name: 'TIGER 10W30 SL',
      productCode: 'BT-10W30',
      categorySlug: 'passenger-cars',
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
      currency: 'SAR',
      unitPrice: 120,
      inStock: true,
      packagingOptions: [],
      segmentTags: ['commercial'],
      applicationTags: ['diesel-engine'],
      viscosity: '15w-40',
    },
  ] as unknown as ProductFixture[];

  it('infers passenger petrol intent for Ford Mustang queries', () => {
    const intent = inferChatIntent(
      'I am looking for engine oil for my ford mustang 2023',
    );
    expect(intent.wantsRecommendation).toBe(true);
    expect(intent.vehicleLabel?.toLowerCase()).toContain('mustang');
    expect(intent.segmentSlugs).toContain('passenger-cars');
    expect(intent.applicationTags).toContain('petrol-engine');
    expect(intent.fuel).toBe('petrol');
  });

  it('prefers passenger oils in the catalog slice for Mustang queries', () => {
    const { slice, intent } = selectProductsForChat(
      'engine oil for ford mustang 2023',
      products,
      30,
    );
    expect(intent.segmentSlugs).toContain('passenger-cars');
    expect(slice[0]?.slug).toContain('10w30');
  });

  it('detects Arabic reply language', () => {
    const intent = inferChatIntent('أبحث عن زيت محرك لسيارتي');
    expect(intent.language).toBe('ar');
  });

  it('detects English reply language', () => {
    const intent = inferChatIntent('I need engine oil for my car');
    expect(intent.language).toBe('en');
  });
});
