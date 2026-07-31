/** Mock catalog aligned with openapi-catalog-v1 + DESIGN_TO_API_MAPPING.md */

export const MOCK_CATEGORY_TREE = {
  categories: [
    {
      slug: 'products',
      name: 'PRODUCTS',
      children: [
        {
          slug: 'passenger-cars',
          name: 'PASSENGER CARS',
          href: '/products/passenger-cars',
          children: [] as Array<{ slug: string; name: string; href: string }>,
        },
        {
          slug: 'commercial',
          name: 'COMMERCIAL VEHICLES',
          href: '/products/commercial',
          children: [],
        },
        {
          slug: 'industrial',
          name: 'INDUSTRIAL',
          href: '/products/industrial',
          children: [],
        },
      ],
    },
  ],
};

export interface PackagingFixture {
  id: string;
  label: string;
  sku?: string;
  badges?: Array<'sale'>;
  default?: boolean;
  /** Variant-specific list price when loaded from Odoo */
  unitPrice?: number;
  /** Partial / full pallet tables for this packaging variant. */
  pricing?: Record<string, unknown>;
}

export interface ProductFixture {
  id: string;
  slug: string;
  name: string;
  productCode: string;
  categorySlug: string;
  categoryLabel: string;
  /** Storefront segment keys from Odoo `bt_segment_tags` (e.g. passenger-cars). */
  segmentTags?: string[];
  /** Application facet keys from Odoo `bt_application_tags` (e.g. petrol-engine). */
  applicationTags?: string[];
  /** Product line from Odoo `bt_product_line` (tiger_x | tiger_plus | tiger | other). */
  productLine?: string;
  /** SAE viscosity from Odoo `bt_viscosity` (e.g. 5w-30). */
  viscosity?: string;
  shortDescription?: string;
  subtitle?: string;
  sizeLabel?: string;
  imageUrl: string;
  gallery?: Array<{ url: string; alt: string }>;
  unitPrice: number;
  currency: string;
  badges?: Array<'new' | 'sale'>;
  inStock: boolean;
  packagingOptions: PackagingFixture[];
  pricing: Record<string, unknown>;
  descriptionHtml?: string;
  benefits?: string[];
  specifications?: string[];
  typicals?: Array<{ test: string; method: string; unit: string; value: string }>;
  oemCrossReference?: Array<{ brand: string; productName: string }>;
  documents?: Array<{ type: 'pds' | 'sds' | 'other'; title: string; url: string }>;
  relatedSlugs?: string[];
}

const IMG = 'https://placehold.co/600x600/1a1a1a/f5f5f5/png?text=Black+Tiger';

type ProductSeed = Omit<ProductFixture, 'pricing' | 'currency' | 'inStock'> &
  Partial<Pick<ProductFixture, 'currency' | 'inStock' | 'badges' | 'documents'>> & {
    pricing?: Record<string, unknown>;
  };

function baseProduct(seed: ProductSeed): ProductFixture {
  const currency = seed.currency ?? 'SAR';
  const inStock = seed.inStock ?? true;
  const badges = seed.badges ?? [];
  const documents = seed.documents ?? [];
  const pricing: Record<string, unknown> = {
    currency,
    unitPrice: seed.unitPrice,
    formattedTotal: `${seed.unitPrice.toLocaleString('en-SA')} SAR`,
    partialPalletTiers: [],
    fullPalletTiers: [],
    notices: [],
    lineSummary: {
      packagingLabel: seed.packagingOptions[0]?.label ?? '',
      palletType: 'unit',
      quantity: 1,
      unitPrice: seed.unitPrice,
      extendedPrice: seed.unitPrice,
      totalPrice: seed.unitPrice,
      currency,
    },
    ...(seed.pricing ?? {}),
  };
  return {
    id: seed.id,
    slug: seed.slug,
    name: seed.name,
    productCode: seed.productCode,
    categorySlug: seed.categorySlug,
    categoryLabel: seed.categoryLabel,
    segmentTags: seed.segmentTags,
    applicationTags: seed.applicationTags,
    productLine: seed.productLine,
    viscosity: seed.viscosity,
    shortDescription: seed.shortDescription,
    subtitle: seed.subtitle,
    sizeLabel: seed.sizeLabel,
    imageUrl: seed.imageUrl,
    gallery: seed.gallery,
    unitPrice: seed.unitPrice,
    currency,
    badges,
    inStock,
    packagingOptions: seed.packagingOptions,
    pricing,
    descriptionHtml: seed.descriptionHtml,
    benefits: seed.benefits,
    specifications: seed.specifications,
    typicals: seed.typicals,
    oemCrossReference: seed.oemCrossReference,
    documents,
    relatedSlugs: seed.relatedSlugs,
  };
}

export const PRODUCTS_BY_SLUG: Record<string, ProductFixture> = {
  'tiger-10w30-sl-fully-synthetic': baseProduct({
    id: 'p-tiger-10w30',
    slug: 'tiger-10w30-sl-fully-synthetic',
    name: 'TIGER 10W30 SL Fully Synthetic',
    productCode: 'PRODUCT 65518',
    categorySlug: 'passenger-cars',
    categoryLabel: 'ENGINE OILS',
    segmentTags: ['passenger-cars'],
    applicationTags: ['petrol-engine', 'diesel-engine'],
    productLine: 'tiger_plus',
    viscosity: '10w-30',
    subtitle: 'Full Synthetic, API SL, Engine Oils',
    sizeLabel: '1 Litre (12 Pack)',
    shortDescription: 'Adaptive shield technology for passenger gasoline engines.',
    imageUrl: IMG,
    gallery: [
      { url: IMG, alt: 'TIGER 10W30 SL — front' },
      { url: IMG, alt: 'TIGER 10W30 SL — angle' },
      { url: IMG, alt: 'TIGER 10W30 SL — back' },
    ],
    unitPrice: 83262.8,
    badges: ['sale'],
    packagingOptions: [
      {
        id: 'pkg-box-1l-x12',
        label: 'Box 1LX12',
        sku: 'BT-10W30-1L12',
        default: true,
        unitPrice: 88.5,
        pricing: {
          partialPallet: {
            title: 'Price Per Partial Pallet',
            columns: ['Box QTY', 'Unit Price', 'EXT Price'],
            rows: [
              { boxQty: 2, unitPrice: '88.50 SAR', extPrice: '177.00 SAR' },
              { boxQty: 10, unitPrice: '85.00 SAR', extPrice: '850.00 SAR' },
            ],
          },
          fullPallet: {
            title: 'Price Per Full Pallet',
            columns: ['Pallet QTY', 'Box Per Pallet', 'Total Box QTY', 'Unit Price', 'EXT Price'],
            rows: [
              { palletQty: 1, boxPerPallet: 48, totalBoxQty: 48, unitPrice: '83.26 SAR', extPrice: '3,996.48 SAR' },
            ],
          },
        },
      },
      {
        id: 'pkg-box-5l-x12-a',
        label: 'Box 5LX12',
        sku: 'BT-10W30-5L12',
        unitPrice: 425,
        pricing: {
          partialPallet: {
            rows: [
              { boxQty: 2, unitPrice: '418.00 SAR', extPrice: '836.00 SAR' },
              { boxQty: 5, unitPrice: '410.00 SAR', extPrice: '2,050.00 SAR' },
            ],
          },
          fullPallet: {
            rows: [
              { palletQty: 1, boxPerPallet: 24, totalBoxQty: 24, unitPrice: '398.50 SAR', extPrice: '9,564.00 SAR' },
            ],
          },
        },
      },
      {
        id: 'pkg-20l-pail',
        label: '20 Liter Pail',
        sku: 'BT-10W30-20L',
        badges: ['sale'],
        unitPrice: 295,
        pricing: {
          partialPallet: {
            rows: [
              { boxQty: 2, unitPrice: '288.00 SAR', extPrice: '576.00 SAR' },
              { boxQty: 6, unitPrice: '280.00 SAR', extPrice: '1,680.00 SAR' },
            ],
          },
        },
      },
      {
        id: 'pkg-208l-drum',
        label: '208 Liter Drum',
        sku: 'BT-10W30-208',
        unitPrice: 2680,
        pricing: {
          partialPallet: {
            rows: [{ boxQty: 1, unitPrice: '2,650.00 SAR', extPrice: '2,650.00 SAR' }],
          },
        },
      },
    ],
    descriptionHtml:
      '<p>Fully synthetic formulation engineered for severe driving cycles.</p><p>Preferred for modern gasoline engines requiring API SL performance levels.</p>',
    benefits: [
      'Significantly improved engine performance',
      'Excellent wear protection under high load',
      'Enhanced fuel economy retention',
      'Outstanding cold-start protection',
    ],
    specifications: ['API SP / SN Plus', 'Ford Eco-Boost', 'ILSAC GF-6A'],
    typicals: [
      { test: 'Kinematic Viscosity @ 100°C', method: 'ASTM D445', unit: 'cSt', value: '12.1' },
      { test: 'Viscosity Index', method: 'ASTM D2270', unit: '—', value: '168' },
    ],
    oemCrossReference: [
      { brand: 'Castrol', productName: 'Edge 10W-30' },
      { brand: 'Mobil', productName: '1 10W-30' },
    ],
    documents: [
      { type: 'pds', title: 'Product Data Sheet', url: '#' },
      { type: 'sds', title: 'Safety Data Sheet', url: '#' },
    ],
    relatedSlugs: ['tiger-x-5w30-sn', 'tiger-20w50-sl'],
    pricing: {
      formattedUnitPrice: '83,262.80 SAR',
      lineSummaryRows: [
        {
          packaging: 'Box 1LX12',
          pallet: 'Partial Pallet',
          qty: 961,
          unitPrice: '83,262.80 SAR',
          extPrice: '80,005,590.80 SAR',
        },
      ],
      totalPrice: '80,005,590.80 SAR',
      partialPallet: {
        title: 'Price Per Partial Pallet',
        columns: ['Box QTY', 'Unit Price', 'EXT Price'],
        rows: [
          { boxQty: 2, unitPrice: '88.50 SAR', extPrice: '177.00 SAR' },
          { boxQty: 10, unitPrice: '85.00 SAR', extPrice: '850.00 SAR' },
        ],
        notice: 'Partial pallet pricing reflects combined box quantities shipped on a single pallet.',
      },
      fullPallet: {
        title: 'Price Per Full Pallet',
        columns: ['Pallet QTY', 'Box Per Pallet', 'Total Box QTY', 'Unit Price', 'EXT Price'],
        rows: [
          { palletQty: 1, boxPerPallet: 48, totalBoxQty: 48, unitPrice: '83.26 SAR', extPrice: '3,996.48 SAR' },
        ],
        notice: 'Volume advantage: full pallet orders unlock the lowest unit price per box.',
      },
    },
  }),
  'tiger-x-5w30-sn': baseProduct({
    id: 'p-tiger-x-5w30',
    slug: 'tiger-x-5w30-sn',
    name: 'TIGER X 5W30 SN',
    productCode: 'PRODUCT 65518',
    categorySlug: 'passenger-cars',
    categoryLabel: 'ENGINE OILS',
    segmentTags: ['passenger-cars', 'motorcycle-atv'],
    applicationTags: ['petrol-engine', 'hybrid'],
    productLine: 'tiger_x',
    viscosity: '5w-30',
    subtitle: 'Full Synthetic, API SN, Engine Oils',
    sizeLabel: '1 Litre (12 Pack)',
    shortDescription:
      'This sustainable RRBE racing oil, fortified with ester and PAG, increases total engine protection.',
    imageUrl: IMG,
    gallery: [
      { url: IMG, alt: 'TIGER X 5W30 SN — front' },
      { url: IMG, alt: 'TIGER X 5W30 SN — angle' },
    ],
    unitPrice: 74210,
    badges: ['new'],
    packagingOptions: [
      { id: 'pkg-5w30-1l-x12', label: 'Box 1LX12', default: true },
      { id: 'pkg-5w30-5l-x4', label: 'Pail 5L X 4', sku: 'BT-5W30-5L4' },
      { id: 'pkg-5w30-208l', label: '208 Liter Drum', badges: ['sale'] },
    ],
    descriptionHtml: '<p>TIGER X 5W30 SN is formulated for modern gasoline engines requiring API SN performance.</p>',
    benefits: ['Wear protection', 'Fuel economy retention', 'Cold start performance'],
    specifications: ['API SN', 'ILSAC GF-5'],
    typicals: [
      { test: 'Kinematic Viscosity @ 100°C', method: 'ASTM D445', unit: 'cSt', value: '11.8' },
    ],
    oemCrossReference: [{ brand: 'Mobil', productName: '1 5W-30' }],
    documents: [
      { type: 'pds', title: 'Product Data Sheet', url: '#' },
      { type: 'sds', title: 'Safety Data Sheet', url: '#' },
    ],
    relatedSlugs: ['tiger-10w30-sl-fully-synthetic', 'tiger-20w50-sl'],
    pricing: {
      formattedUnitPrice: '74,210.00 SAR',
      lineSummaryRows: [
        {
          packaging: 'Box 1LX12',
          pallet: 'Partial Pallet',
          qty: 480,
          unitPrice: '74,210.00 SAR',
          extPrice: '35,620,800.00 SAR',
        },
      ],
      totalPrice: '35,620,800.00 SAR',
      partialPallet: {
        title: 'Price Per Partial Pallet',
        columns: ['Box QTY', 'Unit Price', 'EXT Price'],
        rows: [{ boxQty: 2, unitPrice: '78.90 SAR', extPrice: '157.80 SAR' }],
        notice: 'Partial pallet pricing reflects combined box quantities shipped on a single pallet.',
      },
      fullPallet: {
        title: 'Price Per Full Pallet',
        columns: ['Pallet QTY', 'Box Per Pallet', 'Total Box QTY', 'Unit Price', 'EXT Price'],
        rows: [
          { palletQty: 1, boxPerPallet: 48, totalBoxQty: 48, unitPrice: '74.21 SAR', extPrice: '3,562.08 SAR' },
        ],
        notice: 'Volume advantage: full pallet orders unlock the lowest unit price per box.',
      },
    },
  }),
  'tiger-20w50-sl': baseProduct({
    id: 'p-tiger-20w50',
    slug: 'tiger-20w50-sl',
    name: 'TIGER 20W50 SL Mineral Blend',
    productCode: 'PRODUCT 66880',
    categorySlug: 'passenger-cars',
    categoryLabel: 'ENGINE OILS',
    segmentTags: ['commercial', 'passenger-cars'],
    applicationTags: ['diesel-engine', 'petrol-engine'],
    productLine: 'tiger',
    viscosity: '20w-50',
    subtitle: 'Mineral Blend, API SL, Engine Oils',
    sizeLabel: '1 Litre (12 Pack)',
    shortDescription: 'High-performance mineral blend for warmer climates.',
    imageUrl: IMG,
    unitPrice: 52199,
    packagingOptions: [
      { id: 'pkg-20w50-1l-x12', label: 'Box 1LX12', default: true },
      { id: 'pkg-20w50-4l-x4', label: 'Box 4L X 4' },
    ],
    descriptionHtml: '<p>TIGER 20W50 SL is a high-performance mineral blend suited for warmer climates and mixed fleets.</p>',
    benefits: ['High-temperature stability', 'Strong wear protection'],
    specifications: ['API SL', 'CI-4'],
    documents: [
      { type: 'pds', title: 'Product Data Sheet', url: '#' },
      { type: 'sds', title: 'Safety Data Sheet', url: '#' },
    ],
    relatedSlugs: ['tiger-10w30-sl-fully-synthetic', 'tiger-x-5w30-sn'],
    pricing: {
      formattedUnitPrice: '52,199.00 SAR',
      partialPallet: {
        title: 'Price Per Partial Pallet',
        columns: ['Box QTY', 'Unit Price', 'EXT Price'],
        rows: [{ boxQty: 5, unitPrice: '55.00 SAR', extPrice: '275.00 SAR' }],
        notice: 'Contact your distributor for partial pallet configuration.',
      },
      fullPallet: {
        title: 'Price Per Full Pallet',
        columns: ['Pallet QTY', 'Box Per Pallet', 'Total Box QTY', 'Unit Price', 'EXT Price'],
        rows: [
          { palletQty: 1, boxPerPallet: 48, totalBoxQty: 48, unitPrice: '52.20 SAR', extPrice: '2,505.60 SAR' },
        ],
        notice: 'Full pallet pricing available for fleet orders.',
      },
    },
  }),
  'commercial-15w40-ci4': baseProduct({
    id: 'p-com-15w40',
    slug: 'commercial-15w40-ci4',
    name: 'TIGER COMMERCIAL 15W40 CI-4',
    productCode: 'PRODUCT 70221',
    categorySlug: 'commercial',
    categoryLabel: 'HEAVY DUTY',
    segmentTags: ['commercial'],
    applicationTags: ['diesel-engine', 'transmission'],
    productLine: 'tiger',
    viscosity: '15w-40',
    subtitle: 'Diesel Engine Oil, API CI-4',
    sizeLabel: '208 Liter Drum',
    shortDescription: 'Diesel engine oil for commercial fleets.',
    imageUrl: IMG,
    unitPrice: 68900,
    packagingOptions: [
      { id: 'pkg-15w40-208l', label: 'Drum 208L', default: true },
      { id: 'pkg-15w40-20l-x48', label: 'Pail 20L' },
    ],
    descriptionHtml: '<p>Heavy-duty diesel engine oil for commercial fleets and severe service.</p>',
    benefits: ['Extended drain intervals', 'Soot control', 'Acid neutralization'],
    specifications: ['API CI-4', 'ACEA E7'],
    documents: [
      { type: 'pds', title: 'Product Data Sheet', url: '#' },
      { type: 'sds', title: 'Safety Data Sheet', url: '#' },
    ],
    relatedSlugs: ['tiger-20w50-sl'],
    pricing: {
      formattedUnitPrice: '68,900.00 SAR',
      partialPallet: {
        title: 'Price Per Partial Pallet',
        columns: ['Box QTY', 'Unit Price', 'EXT Price'],
        rows: [{ boxQty: 2, unitPrice: '72.00 SAR', extPrice: '144.00 SAR' }],
        notice: 'Partial pallet pricing for mixed drum and pail orders.',
      },
      fullPallet: {
        title: 'Price Per Full Pallet',
        columns: ['Pallet QTY', 'Box Per Pallet', 'Total Box QTY', 'Unit Price', 'EXT Price'],
        rows: [
          { palletQty: 1, boxPerPallet: 4, totalBoxQty: 4, unitPrice: '68.90 SAR', extPrice: '275.60 SAR' },
        ],
        notice: 'Full pallet drum pricing for fleet distributors.',
      },
    },
  }),
};

export const FEATURED_SLUGS = [
  'tiger-10w30-sl-fully-synthetic',
  'tiger-x-5w30-sn',
  'commercial-15w40-ci4',
];

export function productToCard(p: ProductFixture) {
  const packagingOptions = (p.packagingOptions ?? []).map((o) => {
    const unitPrice = o.unitPrice ?? p.unitPrice;
    return {
      id: o.id,
      label: o.label,
      sku: o.sku,
      badges: o.badges,
      default: o.default,
      unitPrice,
      formattedUnitPrice: `${unitPrice.toLocaleString('en-SA')} ${p.currency}`,
    };
  });
  const optionPrices = packagingOptions
    .map((o) => o.unitPrice)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const fromPrice = optionPrices.length ? Math.min(...optionPrices) : p.unitPrice;

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    productCode: p.productCode,
    categoryLabel: p.categoryLabel,
    shortDescription: p.shortDescription,
    image: { url: p.imageUrl, alt: p.name },
    packagingOptions,
    price: {
      currency: p.currency,
      amount: fromPrice,
      formatted: `From ${fromPrice.toLocaleString('en-SA')} ${p.currency}`,
      prefix: 'From',
    },
    badges: p.badges ?? [],
    inStock: p.inStock,
    viewHref: `/products/${p.slug}`,
  };
}

import {
  buildCatalogFacets,
  type CatalogFacetOptions,
} from '../modules/catalog/catalog-taxonomy';

export function buildFacets(
  items: ProductFixture[],
  options: CatalogFacetOptions = {},
) {
  return buildCatalogFacets(items, options);
}
