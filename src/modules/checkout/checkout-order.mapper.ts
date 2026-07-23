import type {
  StorefrontAddressInput,
  StorefrontCheckoutPayload,
} from '../../infrastructure/odoo/odoo-order.service';
import type { StoredUser } from '../../persistence/persistence.service';
import type { ResolvedAddr, ResolvedCt } from './checkout.service';

function mapAddress(
  addr: ResolvedAddr | undefined,
  contact?: ResolvedCt,
): StorefrontAddressInput {
  return {
    name: addr?.recipientName || contact?.fullName || undefined,
    email: contact?.email || undefined,
    phone: contact?.phone || undefined,
    address_line1: addr?.addressLine1 || undefined,
    address_line2: addr?.addressLine2 || undefined,
    city: addr?.city || undefined,
    postal_code: addr?.postalCode || undefined,
    country_code: addr?.countryCode || 'SA',
  };
}

export function buildStorefrontCheckoutPayload(input: {
  cartId: string;
  user: StoredUser;
  resolved: Record<string, unknown>;
  cartItems: Array<{
    productSlug: string;
    packagingOptionId: string;
    quantity: number;
    palletType: 'unit' | 'partial' | 'full';
    unitPrice?: number;
  }>;
  shippingAmount: number;
  shippingLabel: string;
  shippingOptionId: string;
  note?: string;
}): StorefrontCheckoutPayload {
  const shipping = input.resolved['shipping'] as ResolvedAddr | undefined;
  const billing = input.resolved['billing'] as ResolvedAddr | undefined;
  const contacts = input.resolved['contacts'] as
    | Record<string, ResolvedCt>
    | undefined;
  const delivery = contacts?.['delivery'];

  const customerName =
    delivery?.fullName ||
    input.user.displayName ||
    `${input.user.firstName ?? ''} ${input.user.lastName ?? ''}`.trim() ||
    input.user.email;

  return {
    cart_id: input.cartId,
    customer: {
      name: customerName,
      email: delivery?.email || input.user.email,
      phone: delivery?.phone || input.user.phone,
    },
    shipping_address: mapAddress(shipping, delivery),
    billing_address: mapAddress(billing || shipping, delivery),
    lines: input.cartItems.map((line) => ({
      product_slug: line.productSlug,
      packaging_option_id: line.packagingOptionId,
      quantity: line.quantity,
      pallet_type: line.palletType,
      price_unit: line.unitPrice ?? 0,
    })),
    shipping_amount: input.shippingAmount,
    shipping_label: input.shippingLabel,
    shipping_option_id: input.shippingOptionId,
    note: input.note,
  };
}
