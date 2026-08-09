import { packVehiclesForPallets, VEHICLE_CATALOG } from './vehicle-fleet';

describe('packVehiclesForPallets', () => {
  it('returns empty plan for 0 pallets', () => {
    const plan = packVehiclesForPallets(0);
    expect(plan.vehicles).toHaveLength(0);
    expect(plan.totalAmount).toBe(0);
  });

  it('uses pick-up for 3 pallets', () => {
    const plan = packVehiclesForPallets(3);
    expect(plan.vehicles).toEqual([
      expect.objectContaining({
        id: 'pickup-3t',
        qty: 1,
        palletsLoaded: 3,
        lineTotal: 500,
      }),
    ]);
    expect(plan.totalAmount).toBe(500);
  });

  it('uses medium + pick-up for 8 pallets', () => {
    const plan = packVehiclesForPallets(8);
    expect(plan.vehicles.map((v) => ({ id: v.id, qty: v.qty, palletsLoaded: v.palletsLoaded }))).toEqual([
      { id: 'medium-rigid-6w', qty: 1, palletsLoaded: 7 },
      { id: 'pickup-3t', qty: 1, palletsLoaded: 1 },
    ]);
    expect(plan.totalAmount).toBe(1500);
  });

  it('uses heavy rigid alone for 12 pallets', () => {
    const plan = packVehiclesForPallets(12);
    expect(plan.vehicles).toEqual([
      expect.objectContaining({ id: 'heavy-rigid-10w', qty: 1, palletsLoaded: 12, lineTotal: 1500 }),
    ]);
  });

  it('tiers mock prices by 500 SAR', () => {
    expect(VEHICLE_CATALOG.map((v) => v.unitPrice)).toEqual([500, 1000, 1500, 2000, 2500]);
  });
});
