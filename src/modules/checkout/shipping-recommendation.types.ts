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
