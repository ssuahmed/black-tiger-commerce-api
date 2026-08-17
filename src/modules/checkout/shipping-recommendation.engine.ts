/**
 * Builds checkout shipping options and pallet-utilization recommendations.
 *
 * Combines cart logistics (pallet counts/weights from packaging tiers) with
 * the vehicle fleet packer to produce a recommended `fleet-auto` option,
 * efficiency score/hints, and related product suggestions.
 */
import { Injectable } from '@nestjs/common';
import type { ProductFixture } from '../../mocks/catalog.fixtures';
import { productToCard } from '../../mocks/catalog.fixtures';
import type {
  CartLineForShipping,
  EnrichedShippingOption,
  ShippingLineUtilization,
  ShippingOptionsPayload,
  ShippingRecommendation,
  SuggestedProductCard,
} from './shipping-recommendation.types';
import type { StorefrontShippingOption } from '../../infrastructure/odoo/odoo-shipping.service';
import { CartLogisticsService } from '../cart/cart-logistics.service';
import {
  FLEET_AUTO_OPTION_ID,
  formatFleetSar,
  packVehiclesForPallets,
  VEHICLE_CATALOG,
} from './vehicle-fleet';

const DEFAULT_BOX_PER_PALLET = 48;
const TARGET_UTILIZATION = 0.9;

@Injectable()
export class ShippingRecommendationEngine {
  constructor(
    private readonly logistics: CartLogisticsService = new CartLogisticsService(),
  ) {}

  /** Full shipping payload: enriched fleet options + recommendation block. */
  build(
    _baseOptions: StorefrontShippingOption[],
    lines: CartLineForShipping[],
    productsBySlug: Record<string, ProductFixture>,
  ): ShippingOptionsPayload {
    const recommendation = this.buildRecommendation(lines, productsBySlug);
    const options = this.buildFleetOptions(recommendation);
    return { options, recommendation };
  }

  /** Utilization score, hints, pallet breakdown, and fleet plan for the cart. */
  buildRecommendation(
    lines: CartLineForShipping[],
    productsBySlug: Record<string, ProductFixture>,
  ): ShippingRecommendation {
    const logistics = this.logistics.calculate(lines, productsBySlug);
    const palletBreakdown = {
      fullPallets: logistics.fullPallets,
      fullDrumPallets: logistics.fullDrumPallets,
      partialPallets: logistics.partialPallets,
      totalPallets: logistics.totalPallets,
      totalNetWeightKg: logistics.totalNetWeightKg,
      totalPalletsForShipping: logistics.totalPalletsForShipping,
    };
    const fleetPlan = packVehiclesForPallets(logistics.totalPalletsForShipping);

    if (!lines.length) {
      return {
        efficiency: { score: 0, utilizationPct: 0 },
        hints: ['Add products to your cart to see shipping efficiency.'],
        message:
          'Your cart is empty. Add lubricants to unlock pallet utilization tips and shipping recommendations.',
        lines: [],
        suggestedProducts: [],
        palletBreakdown,
        logistics,
        fleetPlan,
      };
    }

    const utilLines: ShippingLineUtilization[] = [];
    let weightedFill = 0;
    let palletWeight = 0;

    for (const line of lines) {
      const product = productsBySlug[line.productSlug];
      const boxPerPallet = this.resolveBoxPerPallet(
        product,
        line.packagingOptionId,
      );
      const { utilizationPct, palletEquivalents } = this.lineUtilization(
        line.palletType,
        line.quantity,
        boxPerPallet,
      );
      utilLines.push({
        lineId: line.id,
        productSlug: line.productSlug,
        productName: line.productName || product?.name || line.productSlug,
        packagingLabel: line.packagingLabel,
        palletType: line.palletType,
        quantity: line.quantity,
        boxPerPallet,
        utilizationPct: Math.round(utilizationPct * 100),
        palletEquivalents,
      });
      weightedFill += utilizationPct * palletEquivalents;
      palletWeight += palletEquivalents;
    }

    const utilization =
      palletWeight > 0 ? Math.min(1, weightedFill / palletWeight) : 0;
    const score = Math.round(utilization * 100);
    const hints = this.buildHints(utilLines, score, fleetPlan);
    const message = this.buildMessage(score, fleetPlan);

    return {
      efficiency: { score, utilizationPct: score },
      hints,
      message,
      lines: utilLines,
      suggestedProducts: this.suggestProducts(lines, productsBySlug),
      palletBreakdown,
      logistics,
      fleetPlan,
    };
  }

  /** Per-vehicle rows plus the recommended fleet-total option. */
  private buildFleetOptions(
    recommendation: ShippingRecommendation,
  ): EnrichedShippingOption[] {
    const plan = recommendation.fleetPlan ?? packVehiclesForPallets(0);
    const vehicleRows: EnrichedShippingOption[] = plan.vehicles.map((v) => ({
      id: v.id,
      label: v.label,
      etaDays: VEHICLE_CATALOG.find((c) => c.id === v.id)?.etaDays ?? 5,
      price: {
        currency: 'SAR',
        amount: v.unitPrice,
        formatted: formatFleetSar(v.unitPrice),
      },
      recommended: false,
      reason: null,
      qty: v.qty,
      palletsLoaded: v.palletsLoaded,
      unitPrice: v.unitPrice,
      lineTotal: v.lineTotal,
      isFleetTotal: false,
    }));

    const fleetTotal: EnrichedShippingOption = {
      id: FLEET_AUTO_OPTION_ID,
      label: 'Calculated vehicle fleet',
      etaDays: 5,
      price: {
        currency: 'SAR',
        amount: plan.totalAmount,
        formatted: formatFleetSar(plan.totalAmount),
      },
      recommended: true,
      reason:
        plan.vehicles.length > 0
          ? `Optimal mix for ${plan.totalPallets} pallet(s): ${plan.vehicles
              .map((v) => `${v.qty}× ${v.label}`)
              .join(' + ')}.`
          : 'No pallets to ship.',
      qty: plan.vehicles.reduce((sum, v) => sum + v.qty, 0),
      palletsLoaded: plan.totalPallets,
      unitPrice: plan.totalAmount,
      lineTotal: plan.totalAmount,
      isFleetTotal: true,
    };

    return [...vehicleRows, fleetTotal];
  }

  private resolveBoxPerPallet(
    product: ProductFixture | undefined,
    packagingOptionId: string,
  ): number {
    const pkg = product?.packagingOptions?.find(
      (p) => p.id === packagingOptionId,
    );
    const pricing = pkg?.pricing as
      | { fullPallet?: { rows?: Array<{ boxPerPallet?: number }> } }
      | undefined;
    const fromRow = pricing?.fullPallet?.rows?.[0]?.boxPerPallet;
    if (typeof fromRow === 'number' && fromRow > 0) return fromRow;
    return DEFAULT_BOX_PER_PALLET;
  }

  private lineUtilization(
    palletType: 'unit' | 'partial' | 'full',
    quantity: number,
    boxPerPallet: number,
  ): { utilizationPct: number; palletEquivalents: number } {
    const qty = Math.max(0, Number(quantity) || 0);
    if (palletType === 'full') {
      return { utilizationPct: 1, palletEquivalents: Math.max(qty, 1) };
    }
    if (qty <= 0) {
      return { utilizationPct: 0, palletEquivalents: 1 };
    }
    const fullPallets = Math.floor(qty / boxPerPallet);
    const remainder = qty % boxPerPallet;
    if (fullPallets === 0) {
      return {
        utilizationPct: Math.min(1, qty / boxPerPallet),
        palletEquivalents: 1,
      };
    }
    if (remainder === 0) {
      return { utilizationPct: 1, palletEquivalents: fullPallets };
    }
    const remUtil = remainder / boxPerPallet;
    const palletEquivalents = fullPallets + 1;
    const utilizationPct = (fullPallets + remUtil) / palletEquivalents;
    return { utilizationPct, palletEquivalents };
  }

  private buildHints(
    lines: ShippingLineUtilization[],
    score: number,
    fleetPlan: ReturnType<typeof packVehiclesForPallets>,
  ): string[] {
    const hints: string[] = [];
    if (fleetPlan.vehicles.length) {
      hints.push(
        `Fleet: ${fleetPlan.vehicles
          .map((v) => `${v.qty}× ${v.label}`)
          .join(' + ')} (${formatFleetSar(fleetPlan.totalAmount)}).`,
      );
    }
    if (score >= 90) {
      hints.push('Pallet utilization is excellent — proceed with checkout.');
      return hints;
    }
    const incomplete = lines
      .filter(
        (l) =>
          l.utilizationPct < TARGET_UTILIZATION * 100 &&
          l.palletType !== 'full',
      )
      .sort((a, b) => a.utilizationPct - b.utilizationPct)[0];
    if (incomplete) {
      const targetBoxes = Math.ceil(
        TARGET_UTILIZATION * incomplete.boxPerPallet,
      );
      const need = Math.max(0, targetBoxes - incomplete.quantity);
      if (need > 0) {
        hints.push(
          `Add ~${need} more box(es) of ${incomplete.productName} to reach ~90% pallet fill.`,
        );
      }
    }
    if (score < 50) {
      hints.push(
        'Consider consolidating into fewer fuller pallets to improve freight efficiency.',
      );
    }
    if (hints.length <= 1) {
      hints.push(
        'Increase pallet fill toward 90% for a more efficient shipment.',
      );
    }
    return hints;
  }

  private buildMessage(
    score: number,
    fleetPlan: ReturnType<typeof packVehiclesForPallets>,
  ): string {
    const fleetBit =
      fleetPlan.vehicles.length > 0
        ? ` Recommended fleet: ${fleetPlan.vehicles
            .map((v) => `${v.qty}× ${v.label}`)
            .join(' + ')}.`
        : '';
    if (score >= 90) {
      return `Shipping efficiency ${score}% — great pallet utilization.${fleetBit}`;
    }
    if (score >= 70) {
      return `Shipping efficiency ${score}%. A few more units could unlock better freight economics.${fleetBit}`;
    }
    if (score >= 40) {
      return `Shipping efficiency ${score}%. Increase your shipping efficiency to 90% or more for optimized pallet freight.${fleetBit}`;
    }
    return `Shipping efficiency ${score}%. Your load is lightly filled — add volume or switch pallet type to improve utilization.${fleetBit}`;
  }

  private suggestProducts(
    lines: CartLineForShipping[],
    productsBySlug: Record<string, ProductFixture>,
  ): SuggestedProductCard[] {
    const inCart = new Set(lines.map((l) => l.productSlug));
    const seed = productsBySlug[lines[0]?.productSlug ?? ''];
    const category = seed?.categorySlug;
    const all = Object.values(productsBySlug);
    const candidates = all.filter((p) => {
      if (inCart.has(p.slug)) return false;
      if (category && p.categorySlug === category) return true;
      if (category && (p.segmentTags ?? []).includes(category)) return true;
      return false;
    });
    const pool = candidates.length
      ? candidates
      : all.filter((p) => !inCart.has(p.slug));
    return pool.slice(0, 3).map((p) => this.toSuggestedCard(productToCard(p)));
  }

  private toSuggestedCard(card: Record<string, unknown>): SuggestedProductCard {
    const image =
      card.image && typeof card.image === 'object'
        ? (card.image as { url?: string; alt?: string })
        : undefined;
    const price =
      card.price && typeof card.price === 'object'
        ? (card.price as {
            formatted?: string;
            amount?: number;
            currency?: string;
          })
        : undefined;
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined;
    const slug = text(card.slug) ?? '';
    return {
      slug,
      name: text(card.name) ?? slug,
      productCode: text(card.productCode),
      categoryLabel: text(card.categoryLabel),
      image: image?.url ? { url: image.url, alt: image.alt } : undefined,
      price,
      viewHref: text(card.viewHref),
      badges: Array.isArray(card.badges)
        ? (card.badges as string[])
        : undefined,
    };
  }
}
