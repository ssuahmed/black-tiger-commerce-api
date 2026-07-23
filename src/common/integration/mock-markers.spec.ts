import {
  hasMockPackagingId,
  orderNumberLooksLikeMock,
  packagingIdLooksLikeOdoo,
  productLooksLikeMock,
} from './mock-markers';

describe('mock-markers', () => {
  it('detects fixture packaging ids', () => {
    expect(hasMockPackagingId('pkg-box-1l-x12')).toBe(true);
    expect(hasMockPackagingId('pkg-6819')).toBe(false);
  });

  it('detects Odoo-derived packaging ids', () => {
    expect(packagingIdLooksLikeOdoo('pkg-6819')).toBe(true);
    expect(packagingIdLooksLikeOdoo('pkg-box-1l-x12')).toBe(false);
  });

  it('detects mock product images and packaging', () => {
    expect(
      productLooksLikeMock({
        packagingOptions: [{ id: 'pkg-box-1l-x12' }],
        imageUrl: 'https://cdn.example.com/p.jpg',
      }),
    ).toBe(true);
    expect(
      productLooksLikeMock({
        packagingOptions: [{ id: 'pkg-6819' }],
        imageUrl: 'https://cdn.example.com/p.jpg',
      }),
    ).toBe(false);
    expect(
      productLooksLikeMock({
        packagingOptions: [{ id: 'pkg-6819' }],
        imageUrl: 'https://placehold.co/600x600',
      }),
    ).toBe(true);
  });

  it('detects mock order numbers', () => {
    expect(orderNumberLooksLikeMock('BT-M1-ABCDEF12')).toBe(true);
    expect(orderNumberLooksLikeMock('S00004')).toBe(false);
  });
});
