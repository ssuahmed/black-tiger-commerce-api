/**
 * Vehicle fleet catalog and pallet-packing algorithm for storefront freight.
 *
 * Capacities and mock SAR unit costs drive the “calculated vehicle fleet”
 * shipping option shown at checkout (not live Odoo carrier rates).
 */

export interface VehicleType {
  id: string;
  label: string;
  /** Max standard pallets (1.2m × 1.0m) — also used as drum-pallet capacity. */
  maxPallets: number;
  maxDrumPallets: number;
  maxTotalDrums: number;
  /** Mock unit cost in SAR */
  unitPrice: number;
  etaDays: number;
  sequence: number;
}

export interface FleetVehicleLine {
  id: string;
  label: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Pallets actually loaded onto this vehicle group */
  palletsLoaded: number;
  /** Capacity per vehicle */
  maxPallets: number;
  etaDays: number;
}

export interface FleetPlan {
  totalPallets: number;
  totalAmount: number;
  currency: string;
  vehicles: FleetVehicleLine[];
}

export const FLEET_AUTO_OPTION_ID = 'fleet-auto';

/** Ascending capacity — mock cost starts at 500 SAR and +500 per tier. */
export const VEHICLE_CATALOG: VehicleType[] = [
  {
    id: 'pickup-3t',
    label: 'Pick-up / Dyno (3-Ton)',
    maxPallets: 3,
    maxDrumPallets: 3,
    maxTotalDrums: 12,
    unitPrice: 500,
    etaDays: 5,
    sequence: 10,
  },
  {
    id: 'medium-rigid-6w',
    label: 'Medium Rigid Truck (6-Wheeler)',
    maxPallets: 7,
    maxDrumPallets: 7,
    maxTotalDrums: 28,
    unitPrice: 1000,
    etaDays: 5,
    sequence: 20,
  },
  {
    id: 'heavy-rigid-10w',
    label: 'Heavy Rigid Truck (10-Wheeler)',
    maxPallets: 12,
    maxDrumPallets: 12,
    maxTotalDrums: 48,
    unitPrice: 1500,
    etaDays: 5,
    sequence: 30,
  },
  {
    id: 'flatbed-40ft',
    label: 'Standard Flatbed (40 ft / 12.2m)',
    maxPallets: 22,
    maxDrumPallets: 22,
    maxTotalDrums: 88,
    unitPrice: 2000,
    etaDays: 5,
    sequence: 40,
  },
  {
    id: 'flatbed-extended',
    label: 'Extended Flatbed (45–50 ft / 13.6m+)',
    maxPallets: 26,
    maxDrumPallets: 26,
    maxTotalDrums: 104,
    unitPrice: 2500,
    etaDays: 5,
    sequence: 50,
  },
];

function formatSar(amount: number): string {
  return `${amount.toLocaleString('en-SA')} SAR`;
}

/** Flatten the vehicle catalog into storefront shipping option rows. */
export function vehicleCatalogAsStorefrontOptions(): Array<{
  id: string;
  label: string;
  etaDays: number;
  price: { currency: string; amount: number; formatted: string };
}> {
  return VEHICLE_CATALOG.map((v) => ({
    id: v.id,
    label: v.label,
    etaDays: v.etaDays,
    price: {
      currency: 'SAR',
      amount: v.unitPrice,
      formatted: formatSar(v.unitPrice),
    },
  }));
}

/**
 * Pack pallets into vehicles.
 *
 * Strategy (matches “8 pallets → medium + pick-up”):
 * 1. While remaining > 0, take the largest vehicle with capacity ≤ remaining.
 * 2. If none fit, take the smallest vehicle that can cover the remainder.
 */
export function packVehiclesForPallets(totalPallets: number): FleetPlan {
  const pallets = Math.max(0, Math.ceil(Number(totalPallets) || 0));
  if (pallets <= 0) {
    return { totalPallets: 0, totalAmount: 0, currency: 'SAR', vehicles: [] };
  }

  const byCapacityDesc = [...VEHICLE_CATALOG].sort(
    (a, b) => b.maxPallets - a.maxPallets,
  );
  const byCapacityAsc = [...VEHICLE_CATALOG].sort(
    (a, b) => a.maxPallets - b.maxPallets,
  );

  /** Accumulate qty + loaded pallets per vehicle id (insertion order). */
  const order: string[] = [];
  const qtyById = new Map<string, number>();
  const loadedById = new Map<string, number>();

  let remaining = pallets;
  let guard = 0;
  while (remaining > 0 && guard < 500) {
    guard += 1;
    const fit = byCapacityDesc.find((v) => v.maxPallets <= remaining);
    const chosen =
      fit ??
      byCapacityAsc.find((v) => v.maxPallets >= remaining) ??
      byCapacityAsc[byCapacityAsc.length - 1];

    if (!qtyById.has(chosen.id)) order.push(chosen.id);
    qtyById.set(chosen.id, (qtyById.get(chosen.id) ?? 0) + 1);

    const loaded = Math.min(remaining, chosen.maxPallets);
    loadedById.set(chosen.id, (loadedById.get(chosen.id) ?? 0) + loaded);
    remaining -= loaded;
  }

  const catalogById = new Map(VEHICLE_CATALOG.map((v) => [v.id, v]));
  const vehicles: FleetVehicleLine[] = order.map((id) => {
    const v = catalogById.get(id)!;
    const qty = qtyById.get(id) ?? 0;
    const palletsLoaded = loadedById.get(id) ?? 0;
    const lineTotal = qty * v.unitPrice;
    return {
      id: v.id,
      label: v.label,
      qty,
      unitPrice: v.unitPrice,
      lineTotal,
      palletsLoaded,
      maxPallets: v.maxPallets,
      etaDays: v.etaDays,
    };
  });

  const totalAmount = vehicles.reduce((sum, row) => sum + row.lineTotal, 0);
  return {
    totalPallets: pallets,
    totalAmount,
    currency: 'SAR',
    vehicles,
  };
}

/** Format a fleet amount as `N SAR` for storefront display. */
export function formatFleetSar(amount: number): string {
  return formatSar(amount);
}
