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
    address: 'Industrial Area, Riyadh, Saudi Arabia',
    latitude: 24.5854,
    longitude: 46.756,
    phone: '+966 11 000 0001',
    openingHours: 'Sunday–Thursday, 08:00–17:00',
  },
];

export const WAREHOUSES_BY_SLUG = Object.fromEntries(
  WAREHOUSES.map((warehouse) => [warehouse.slug, warehouse]),
) as Record<string, WarehouseFixture>;
