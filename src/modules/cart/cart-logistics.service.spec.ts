import type { ProductFixture } from '../../mocks/catalog.fixtures';
import { CartLogisticsService } from './cart-logistics.service';

const product = {
  slug: 'oil',
  name: 'Oil',
  packagingOptions: [
    {
      id: 'box',
      label: 'Box 1L x 12',
      pricing: { fullPallet: { rows: [{ boxPerPallet: 48 }] } },
    },
    { id: 'drum', label: '208 Liter Drum' },
  ],
  pricing: {},
} as ProductFixture;

describe('CartLogisticsService', () => {
  const service = new CartLogisticsService();

  it('calculates full and partial pallets with default box weight', () => {
    const result = service.calculate(
      [
        {
          id: 'line-1',
          productSlug: 'oil',
          packagingOptionId: 'box',
          quantity: 50,
          palletType: 'partial',
        },
      ],
      { oil: product },
    );

    expect(result.lines[0]).toMatchObject({
      boxPerPallet: 48,
      fullPalletCount: 1,
      partialPalletCount: 1,
      palletEquivalents: 1.04,
      weightKg: 600,
      appliedTier: 'partial',
    });
    expect(result).toMatchObject({
      fullPallets: 1,
      partialPallets: 1,
      totalPallets: 2,
      totalPalletsForShipping: 2,
    });
  });

  it('separates full drum pallets', () => {
    const result = service.calculate(
      [
        {
          id: 'line-2',
          productSlug: 'oil',
          packagingOptionId: 'drum',
          quantity: 2,
          palletType: 'full',
        },
      ],
      { oil: product },
    );

    expect(result.fullPallets).toBe(0);
    expect(result.fullDrumPallets).toBe(2);
    expect(result.totalNetWeightKg).toBe(1152);
  });
});
