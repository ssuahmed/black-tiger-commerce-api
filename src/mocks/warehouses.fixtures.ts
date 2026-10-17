export interface WarehouseFixture {
  slug: string;
  name: string;
  city: string;
  countryCode: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  openingHours: string;
}

export const WAREHOUSES: WarehouseFixture[] = [
  {
    slug: 'bt-warehouse-01-riyadh',
    name: 'BT Warehouse #01',
    city: 'Riyadh',
    countryCode: 'SA',
    address:
      '3463 Old Al-Kharj Road, Hyt Unit, Riyadh, 14371 - 6749 Kingdom of Saudi Arabia',
    latitude: 24.6382,
    longitude: 46.7725,
    phone: '+966-55-5496568',
    openingHours: 'Monday–Thursday & Saturday–Sunday, 08:00 AM–4:00 PM; Friday closed',
  },
];

export const WAREHOUSES_BY_SLUG = Object.fromEntries(
  WAREHOUSES.map((warehouse) => [warehouse.slug, warehouse]),
) as Record<string, WarehouseFixture>;
