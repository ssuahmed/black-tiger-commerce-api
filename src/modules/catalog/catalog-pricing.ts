/**
 * Packaging / pallet pricing resolvers for PLP "From" prices and PDP price-quotes.
 * Reads unit prices and pallet tier tables from product/packaging fixtures
 * (sourced from Odoo when live).
 */
import type { PackagingFixture, ProductFixture } from '../../mocks/catalog.fixtures';

function parseMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

type PalletRow = {
  boxQty?: number;
  unitPrice?: string | number;
  palletQty?: number;
  boxPerPallet?: number;
  totalBoxQty?: number;
};

/** Look up a packaging variant by id on a product. */
export function findPackagingOption(
  product: ProductFixture,
  packagingOptionId: string,
): PackagingFixture | undefined {
  return product.packagingOptions.find((x) => x.id === packagingOptionId);
}

/** Base unit price for a packaging variant, falling back to product template price. */
export function resolvePackagingBasePrice(
  product: ProductFixture,
  packagingOptionId?: string,
): number {
  if (packagingOptionId) {
    const pkg = findPackagingOption(product, packagingOptionId);
    if (pkg?.unitPrice != null && pkg.unitPrice > 0) {
      return pkg.unitPrice;
    }
  }
  const defaultPkg =
    product.packagingOptions.find((o) => o.default) ?? product.packagingOptions[0];
  if (defaultPkg?.unitPrice != null && defaultPkg.unitPrice > 0) {
    return defaultPkg.unitPrice;
  }
  return product.unitPrice;
}

/** Pallet tier tables for the selected packaging option. */
export function resolvePackagingPricing(
  product: ProductFixture,
  packagingOptionId?: string,
): Record<string, unknown> {
  if (packagingOptionId) {
    const pkg = findPackagingOption(product, packagingOptionId);
    if (pkg?.pricing && typeof pkg.pricing === 'object') {
      return pkg.pricing as Record<string, unknown>;
    }
  }
  return (product.pricing ?? {}) as Record<string, unknown>;
}

/**
 * Resolve unit price for price-quote from packaging-specific Odoo tiers.
 */
export function resolveQuoteUnitPrice(
  product: ProductFixture,
  palletType: 'unit' | 'partial' | 'full',
  quantity: number,
  packagingOptionId?: string,
): number {
  const baseUnit = resolvePackagingBasePrice(product, packagingOptionId);
  if (palletType === 'unit') {
    return baseUnit;
  }

  const pricing = resolvePackagingPricing(product, packagingOptionId);
  const partial = pricing.partialPallet as { rows?: PalletRow[] } | undefined;
  const full = pricing.fullPallet as { rows?: PalletRow[] } | undefined;

  if (palletType === 'partial' && partial?.rows?.length) {
    const rows = [...partial.rows].sort((a, b) => (a.boxQty ?? 0) - (b.boxQty ?? 0));
    const match =
      [...rows].reverse().find((r) => (r.boxQty ?? 0) <= quantity) ?? rows[0];
    const unit = parseMoney(match?.unitPrice);
    return unit > 0 ? unit : baseUnit;
  }

  if (palletType === 'full' && full?.rows?.length) {
    const unit = parseMoney(full.rows[0]?.unitPrice);
    return unit > 0 ? unit : baseUnit;
  }

  return baseUnit;
}

/** Lowest packaging unit price for PLP "From" display. */
export function resolveProductFromPrice(product: ProductFixture): number {
  const optionPrices = (product.packagingOptions ?? [])
    .map((o) => o.unitPrice)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  if (optionPrices.length) {
    return Math.min(...optionPrices);
  }
  return product.unitPrice;
}
