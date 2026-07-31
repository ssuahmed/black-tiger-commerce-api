import type { ProductFixture } from '../../mocks/catalog.fixtures';
import type { CartLineEntity } from '../../persistence/persistence.service';

export type LogisticsTier = 'unit' | 'partial' | 'full';

export type CartLogisticsInputLine = Pick<
  CartLineEntity,
  'id' | 'productSlug' | 'packagingOptionId' | 'quantity' | 'palletType'
>;

export interface CartLineLogistics {
  lineId: string;
  boxPerPallet: number;
  fullPalletCount: number;
  partialPalletCount: number;
  palletEquivalents: number;
  weightKg: number;
  appliedTier: LogisticsTier;
  isDrum: boolean;
}

export interface PalletBreakdown {
  fullPallets: number;
  fullDrumPallets: number;
  partialPallets: number;
  totalPallets: number;
  totalNetWeightKg: number;
  totalPalletsForShipping: number;
}

export interface CartLogistics extends PalletBreakdown {
  lines: CartLineLogistics[];
}

export type ProductsBySlug = Record<string, ProductFixture>;
