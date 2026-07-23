import {
  resolvePackagingBasePrice,
  resolveQuoteUnitPrice,
} from './catalog-pricing';
import type { ProductFixture } from '../../mocks/catalog.fixtures';

function product(partial: Partial<ProductFixture>): ProductFixture {
  return {
    id: '1',
    slug: 'test',
    name: 'Test',
    productCode: 'T',
    categorySlug: 'passenger-cars',
    categoryLabel: 'PC',
    imageUrl: 'https://example.com/p.jpg',
    unitPrice: 100,
    currency: 'SAR',
    inStock: true,
    packagingOptions: [{ id: 'pkg-1', label: 'Box' }],
    pricing: {},
    ...partial,
  };
}

describe('resolveQuoteUnitPrice', () => {
  it('uses unit price for unit pallet type', () => {
    const p = product({ unitPrice: 88 });
    expect(resolveQuoteUnitPrice(p, 'unit', 1)).toBe(88);
  });

  it('picks partial pallet tier by quantity', () => {
    const p = product({
      unitPrice: 100,
      pricing: {
        partialPallet: {
          rows: [
            { boxQty: 1, unitPrice: '95' },
            { boxQty: 5, unitPrice: '90' },
          ],
        },
      },
    });
    expect(resolveQuoteUnitPrice(p, 'partial', 5)).toBe(90);
    expect(resolveQuoteUnitPrice(p, 'partial', 3)).toBe(95);
  });

  it('uses full pallet row unit price', () => {
    const p = product({
      unitPrice: 100,
      pricing: {
        fullPallet: { rows: [{ unitPrice: '82.50' }] },
      },
    });
    expect(resolveQuoteUnitPrice(p, 'full', 48)).toBe(82.5);
  });

  it('falls back to unit price when tier missing', () => {
    const p = product({ unitPrice: 77, pricing: {} });
    expect(resolveQuoteUnitPrice(p, 'full', 1)).toBe(77);
  });

  it('uses packaging-specific unit price', () => {
    const p = product({
      unitPrice: 100,
      packagingOptions: [
        { id: 'pkg-a', label: 'Small', unitPrice: 88.5 },
        { id: 'pkg-b', label: 'Drum', unitPrice: 2680 },
      ],
    });
    expect(resolvePackagingBasePrice(p, 'pkg-b')).toBe(2680);
    expect(resolveQuoteUnitPrice(p, 'unit', 1, 'pkg-a')).toBe(88.5);
  });

  it('uses packaging-specific partial tiers', () => {
    const p = product({
      unitPrice: 100,
      packagingOptions: [
        {
          id: 'pkg-a',
          label: 'Box',
          unitPrice: 88.5,
          pricing: {
            partialPallet: {
              rows: [
                { boxQty: 2, unitPrice: '85.00 SAR' },
                { boxQty: 10, unitPrice: '80.00 SAR' },
              ],
            },
          },
        },
      ],
    });
    expect(resolveQuoteUnitPrice(p, 'partial', 10, 'pkg-a')).toBe(80);
    expect(resolveQuoteUnitPrice(p, 'partial', 3, 'pkg-a')).toBe(85);
  });
});
