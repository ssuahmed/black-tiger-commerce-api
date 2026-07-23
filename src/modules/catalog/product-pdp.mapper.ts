import { productToCard, type ProductFixture } from '../../mocks/catalog.fixtures';

export type PdpBreadcrumb = { label: string; href?: string };
export type PdpMediaItem = { url: string; alt: string };
export type PdpDocument = { type: 'pds' | 'sds' | 'other'; title: string; url: string };

export type ProductDetailResponse = {
  id: string;
  slug: string;
  name: string;
  subtitle?: string;
  sizeLabel?: string;
  breadcrumbs: PdpBreadcrumb[];
  media: PdpMediaItem[];
  packagingOptions: ProductFixture['packagingOptions'];
  pricing: Record<string, unknown>;
  descriptionHtml?: string;
  benefits?: string[];
  specifications?: string[];
  typicals?: ProductFixture['typicals'];
  oemCrossReference?: ProductFixture['oemCrossReference'];
  documents?: PdpDocument[];
  relatedProducts: ReturnType<typeof productToCard>[];
  minQuantity: number;
  quantityStep: number;
};

export function buildProductDetailResponse(
  product: ProductFixture,
  productsBySlug: Record<string, ProductFixture>,
): ProductDetailResponse {
  const packagingOptions = product.packagingOptions ?? [];
  const defaultPkg =
    packagingOptions.find((o) => o.default) ?? packagingOptions[0];
  const pricing = normalizePdpPricing(
    product.pricing ?? {},
    product.unitPrice,
    product.currency,
    defaultPkg?.label ?? '',
  );

  const relatedSlugs = product.relatedSlugs ?? [];
  const relatedProducts = relatedSlugs
    .map((s) => productsBySlug[s])
    .filter(Boolean)
    .map(productToCard);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    subtitle: product.subtitle,
    sizeLabel: product.sizeLabel,
    breadcrumbs: buildProductBreadcrumbs(product),
    media: buildProductMedia(product),
    packagingOptions,
    pricing,
    descriptionHtml: product.descriptionHtml,
    benefits: product.benefits,
    specifications: product.specifications,
    typicals: product.typicals,
    oemCrossReference: product.oemCrossReference,
    documents: product.documents,
    relatedProducts,
    minQuantity: 1,
    quantityStep: 1,
  };
}

export function buildProductBreadcrumbs(product: ProductFixture): PdpBreadcrumb[] {
  return [
    { label: 'HOME', href: '/' },
    { label: 'PRODUCTS', href: '/products' },
    {
      label: product.categoryLabel,
      href: `/products/${product.categorySlug}`,
    },
    { label: product.name },
  ];
}

export function buildProductMedia(product: ProductFixture): PdpMediaItem[] {
  if (product.gallery?.length) {
    return product.gallery.map((item) => ({
      url: item.url,
      alt: item.alt || product.name,
    }));
  }
  return [{ url: product.imageUrl, alt: product.name }];
}

export function normalizePdpPricing(
  raw: Record<string, unknown>,
  unitPrice: number,
  currency: string,
  packagingLabel: string,
): Record<string, unknown> {
  const formattedUnitPrice =
    (typeof raw.formattedUnitPrice === 'string' && raw.formattedUnitPrice) ||
    `${unitPrice.toLocaleString('en-SA')} ${currency}`;

  const partialPallet =
    raw.partialPallet ??
    (Array.isArray(raw.partialPalletTiers) && raw.partialPalletTiers[0]) ??
    undefined;
  const fullPallet =
    raw.fullPallet ??
    (Array.isArray(raw.fullPalletTiers) && raw.fullPalletTiers[0]) ??
    undefined;

  const lineSummaryRows = Array.isArray(raw.lineSummaryRows)
    ? raw.lineSummaryRows
    : [];
  const totalPrice =
    (typeof raw.totalPrice === 'string' && raw.totalPrice) ||
    (lineSummaryRows.length > 0
      ? String(
          (lineSummaryRows[lineSummaryRows.length - 1] as { extPrice?: string })
            ?.extPrice ?? '',
        )
      : formattedUnitPrice);

  return {
    currency,
    unitPrice,
    formattedUnitPrice,
    partialPallet,
    fullPallet,
    lineSummaryRows,
    totalPrice: totalPrice || formattedUnitPrice,
    lineSummary: raw.lineSummary ?? {
      packagingLabel,
      palletType: 'unit',
      quantity: 1,
      unitPrice,
      extendedPrice: unitPrice,
      totalPrice: unitPrice,
      currency,
    },
    notices: raw.notices ?? [],
  };
}

export function parseJsonArray<T>(raw: string | false | null | undefined): T[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

export function parseJsonObject<T extends Record<string, unknown>>(
  raw: string | false | null | undefined,
): Partial<T> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Partial<T>)
      : undefined;
  } catch {
    return undefined;
  }
}
