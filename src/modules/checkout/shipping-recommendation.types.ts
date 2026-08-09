import type {
  CartLogistics,
  PalletBreakdown,
} from '../cart/cart-logistics.types';

export interface ShippingLineUtilization {
  lineId: string;
  productSlug: string;
  productName: string;
  packagingLabel?: string;
  palletType: string;
  quantity: number;
  boxPerPallet: number;
  utilizationPct: number;
  palletEquivalents: number;
}

export interface ShippingEfficiency {
  score: number;
  utilizationPct: number;
}

export interface SuggestedProductCard {
  slug: string;
  name: string;
  productCode?: string;
  categoryLabel?: string;
  image?: { url: string; alt?: string };
  price?: { formatted?: string; amount?: number; currency?: string };
  viewHref?: string;
  badges?: string[];
}

export interface ShippingRecommendation {
  efficiency: ShippingEfficiency;
  hints: string[];
  message: string;
  lines: ShippingLineUtilization[];
  suggestedProducts: SuggestedProductCard[];
  palletBreakdown: PalletBreakdown;
  logistics: CartLogistics;
  fleetPlan?: FleetPlanSummary;
}

export interface FleetPlanSummary {
  totalPallets: number;
  totalAmount: number;
  currency: string;
  vehicles: Array<{
    id: string;
    label: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    palletsLoaded: number;
    maxPallets: number;
  }>;
}

export interface EnrichedShippingOption {
  id: string;
  label: string;
  etaDays: number;
  price: {
    currency: string;
    amount: number;
    formatted: string;
  };
  recommended: boolean;
  reason: string | null;
  /** Vehicles of this type in the computed fleet plan (0 when unused). */
  qty?: number;
  /** Pallets loaded onto this vehicle group. */
  palletsLoaded?: number;
  /** Unit price before qty. */
  unitPrice?: number;
  /** qty × unitPrice */
  lineTotal?: number;
  /** True for the selectable fleet total row. */
  isFleetTotal?: boolean;
}

export interface ShippingOptionsPayload {
  options: EnrichedShippingOption[];
  recommendation: ShippingRecommendation;
}

export interface CartLineForShipping {
  id: string;
  productSlug: string;
  productName?: string;
  packagingOptionId: string;
  packagingLabel?: string;
  quantity: number;
  palletType: 'unit' | 'partial' | 'full';
}
