import { ShippingRecommendationEngine } from './shipping-recommendation.engine';
import type { CartLineForShipping } from './shipping-recommendation.types';
import type { StorefrontShippingOption } from '../../infrastructure/odoo/odoo-shipping.service';
import type { ProductFixture } from '../../mocks/catalog.fixtures';
import { FLEET_AUTO_OPTION_ID } from './vehicle-fleet';

describe('ShippingRecommendationEngine', () => {
  const engine = new ShippingRecommendationEngine();

  const baseOptions: StorefrontShippingOption[] = [];

  const productsBySlug: Record<string, ProductFixture> = {
    'tiger-10w30': {
      slug: 'tiger-10w30',
      name: 'TIGER 10W30',
      productCode: 'BT-1',
      categorySlug: 'passenger-cars',
      categoryLabel: 'Passenger',
      currency: 'SAR',
      unitPrice: 88.5,
      inStock: true,
      packagingOptions: [
        {
          id: 'pkg-1',
          label: 'Box',
          default: true,
          unitPrice: 88.5,
          pricing: {
            fullPallet: { rows: [{ boxPerPallet: 48 }] },
          },
        },
      ],
    } as ProductFixture,
  };

  it('returns zero score for empty cart and fleet-auto option', () => {
    const result = engine.build(baseOptions, [], productsBySlug);
    expect(result.recommendation.efficiency.score).toBe(0);
    expect(result.recommendation.lines).toHaveLength(0);
    expect(result.options.some((o) => o.id === FLEET_AUTO_OPTION_ID && o.recommended)).toBe(
      true,
    );
  });

  it('scores full pallet at 100 and packs vehicles', () => {
    const lines: CartLineForShipping[] = [
      {
        id: 'l1',
        productSlug: 'tiger-10w30',
        productName: 'TIGER 10W30',
        packagingOptionId: 'pkg-1',
        quantity: 8,
        palletType: 'full',
      },
    ];
    const result = engine.build(baseOptions, lines, productsBySlug);
    expect(result.recommendation.efficiency.score).toBe(100);
    expect(result.recommendation.fleetPlan?.totalPallets).toBe(8);
    expect(result.recommendation.fleetPlan?.totalAmount).toBe(1500);
    expect(result.options.find((o) => o.id === 'medium-rigid-6w')?.qty).toBe(1);
    expect(result.options.find((o) => o.id === 'pickup-3t')?.qty).toBe(1);
    expect(result.options.find((o) => o.id === FLEET_AUTO_OPTION_ID)?.price.amount).toBe(1500);
  });

  it('scores partial fill and emits add-more hint', () => {
    const lines: CartLineForShipping[] = [
      {
        id: 'l1',
        productSlug: 'tiger-10w30',
        productName: 'TIGER 10W30',
        packagingOptionId: 'pkg-1',
        quantity: 10,
        palletType: 'partial',
      },
    ];
    const result = engine.build(baseOptions, lines, productsBySlug);
    expect(result.recommendation.efficiency.score).toBeLessThan(90);
    expect(result.recommendation.hints.join(' ')).toMatch(/Add ~/);
    expect(result.recommendation.message).toMatch(/efficiency/i);
  });
});
