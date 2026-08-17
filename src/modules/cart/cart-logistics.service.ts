/**
 * Cart logistics calculator: pallet equivalents, drum vs box pallets, and
 * net weight from packaging `boxPerPallet` / weight fields (Odoo tiers when live).
 * Used by cart presentation and the checkout shipping recommendation engine.
 */
import { Injectable } from '@nestjs/common';
import type {
  CartLineLogistics,
  CartLogistics,
  CartLogisticsInputLine,
  ProductsBySlug,
} from './cart-logistics.types';

const DEFAULT_BOX_PER_PALLET = 48;
const DEFAULT_WEIGHT_KG_PER_BOX = 12;

@Injectable()
export class CartLogisticsService {
  /** Aggregate pallet/weight metrics across all cart lines. */
  calculate(
    lines: CartLogisticsInputLine[],
    productsBySlug: ProductsBySlug,
  ): CartLogistics {
    const lineResults = lines.map((line) =>
      this.calculateLine(line, productsBySlug),
    );

    let fullPallets = 0;
    let fullDrumPallets = 0;
    let partialPallets = 0;
    let totalNetWeightKg = 0;

    for (const line of lineResults) {
      if (line.isDrum) {
        fullDrumPallets += line.fullPalletCount;
      } else {
        fullPallets += line.fullPalletCount;
      }
      partialPallets += line.partialPalletCount;
      totalNetWeightKg += line.weightKg;
    }

    const totalPallets = fullPallets + fullDrumPallets + partialPallets;
    return {
      lines: lineResults,
      fullPallets,
      fullDrumPallets,
      partialPallets,
      totalPallets,
      totalNetWeightKg: this.round(totalNetWeightKg),
      totalPalletsForShipping: totalPallets,
    };
  }

  private calculateLine(
    line: CartLogisticsInputLine,
    productsBySlug: ProductsBySlug,
  ): CartLineLogistics {
    const product = productsBySlug[line.productSlug];
    const packaging = product?.packagingOptions.find(
      (option) => option.id === line.packagingOptionId,
    );
    const boxPerPallet = this.boxPerPallet(packaging?.pricing);
    const quantity = Math.max(0, Number(line.quantity) || 0);
    const isDrum = /drum/i.test(
      `${packaging?.label ?? ''} ${packaging?.sku ?? ''}`,
    );

    const fullPalletCount =
      line.palletType === 'full'
        ? quantity
        : Math.floor(quantity / boxPerPallet);
    const remainder = line.palletType === 'full' ? 0 : quantity % boxPerPallet;
    const partialPalletCount = remainder > 0 ? 1 : 0;
    const palletEquivalents =
      line.palletType === 'full' ? quantity : quantity / boxPerPallet;
    const boxes =
      line.palletType === 'full' ? quantity * boxPerPallet : quantity;
    const weightPerBox = this.weightPerBox(
      packaging?.pricing,
      product?.pricing,
    );

    return {
      lineId: line.id,
      boxPerPallet,
      fullPalletCount,
      partialPalletCount,
      palletEquivalents: this.round(palletEquivalents),
      weightKg: this.round(boxes * weightPerBox),
      appliedTier: line.palletType,
      isDrum,
    };
  }

  private boxPerPallet(pricing: unknown): number {
    const rows = (
      pricing as
        | { fullPallet?: { rows?: Array<{ boxPerPallet?: number }> } }
        | undefined
    )?.fullPallet?.rows;
    const value = rows?.find(
      (row) => Number(row.boxPerPallet) > 0,
    )?.boxPerPallet;
    return typeof value === 'number' ? value : DEFAULT_BOX_PER_PALLET;
  }

  private weightPerBox(
    packagingPricing: unknown,
    productPricing: unknown,
  ): number {
    const packagingWeight = packagingPricing as
      | { weightKgPerBox?: number; weightKg?: number }
      | undefined;
    const productWeight = productPricing as
      | { weightKgPerBox?: number; weightKg?: number }
      | undefined;
    const value =
      packagingWeight?.weightKgPerBox ??
      packagingWeight?.weightKg ??
      productWeight?.weightKgPerBox ??
      productWeight?.weightKg;
    return typeof value === 'number' && value > 0
      ? value
      : DEFAULT_WEIGHT_KG_PER_BOX;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
