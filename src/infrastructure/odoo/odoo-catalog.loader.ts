import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PackagingFixture, ProductFixture } from '../../mocks/catalog.fixtures';
import { OdooClient } from './odoo.client';

export type CatalogCategoryBanner = {
  eyebrow?: string;
  title?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: { url: string; alt: string };
};

export type CatalogCategoryDetail = {
  slug: string;
  name: string;
  href: string;
  banner?: CatalogCategoryBanner;
};

export type CatalogCategoryTree = {
  categories: Array<{
    slug: string;
    name: string;
    children: Array<{
      slug: string;
      name: string;
      href: string;
      children?: Array<{ slug: string; name: string; href: string }>;
    }>;
  }>;
};

export type OdooCatalogSnapshot = {
  productsBySlug: Record<string, ProductFixture>;
  categoryTree: CatalogCategoryTree;
  categoriesBySlug: Record<string, CatalogCategoryDetail>;
  featuredSlugs: string[];
};

type OdooCategory = {
  id: number;
  name: string;
  parent_id: [number, string] | false;
  bt_storefront_slug: string | false;
  bt_show_in_storefront: boolean;
  bt_plp_eyebrow: string | false;
  bt_plp_title: string | false;
  bt_plp_body: string | false;
  bt_plp_cta_label: string | false;
  bt_plp_cta_href: string | false;
  bt_plp_image_url: string | false;
};

type OdooTemplate = {
  id: number;
  name: string;
  default_code: string | false;
  list_price: number;
  description_sale: string | false;
  bt_storefront_slug: string;
  bt_product_line: string | false;
  bt_segment_tags: string | false;
  bt_application_tags?: string | false;
  bt_viscosity?: string | false;
  bt_subtitle: string | false;
  bt_size_label: string | false;
  bt_description_html: string | false;
  bt_pricing_notice_partial: string | false;
  bt_pricing_notice_full: string | false;
  bt_related_product_ids: number[] | false;
  categ_id: [number, string] | false;
  qty_available?: number;
};

type OdooVariant = {
  id: number;
  display_name: string;
  default_code: string | false;
  product_tmpl_id: [number, string];
  bt_storefront_sale?: boolean;
  list_price?: number;
  lst_price?: number;
  price_extra?: number;
};

type OdooPricelistItem = {
  product_tmpl_id: [number, string] | false;
  product_id?: [number, string] | false;
  fixed_price: number;
  bt_pallet_type: string | false;
  bt_box_qty: number | false;
  bt_pallet_qty: number | false;
  bt_boxes_per_pallet: number | false;
};

type OdooBenefit = { product_tmpl_id: [number, string]; sequence: number; name: string };
type OdooSpecification = { product_tmpl_id: [number, string]; sequence: number; name: string };
type OdooTypical = {
  product_tmpl_id: [number, string];
  sequence: number;
  test: string;
  method: string | false;
  unit: string | false;
  value: string;
};
type OdooOemLine = {
  product_tmpl_id: [number, string];
  sequence: number;
  brand: string;
  product_name: string;
};
type OdooGalleryImage = {
  id: number;
  product_tmpl_id: [number, string];
  /** Set when image belongs to a packaging variant; false/absent = template-wide. */
  product_id?: [number, string] | false;
  sequence: number;
  name: string;
};
type OdooDocument = {
  id: number;
  product_tmpl_id: [number, string];
  sequence: number;
  doc_type: string;
  name: string;
};

const STORE_ROOT = { slug: 'products', name: 'PRODUCTS' };

@Injectable()
export class OdooCatalogLoader {
  private readonly logger = new Logger(OdooCatalogLoader.name);

  constructor(
    private readonly odoo: OdooClient,
    private readonly config: ConfigService,
  ) {}

  async load(): Promise<OdooCatalogSnapshot> {
    const categories = await this.loadCategories();

    const categoriesById = new Map<number, OdooCategory>();
    for (const c of categories) {
      categoriesById.set(c.id, c);
    }

    const { categoriesBySlug, categoryTree } = buildCategoryViews(categories);

    const templateFields = [
      'name',
      'default_code',
      'list_price',
      'description_sale',
      'bt_storefront_slug',
      'bt_product_line',
      'bt_segment_tags',
      'bt_application_tags',
      'bt_viscosity',
      'bt_subtitle',
      'bt_size_label',
      'bt_description_html',
      'bt_pricing_notice_partial',
      'bt_pricing_notice_full',
      'bt_related_product_ids',
      'categ_id',
      'qty_available',
    ];
    let templates: OdooTemplate[];
    try {
      templates = await this.odoo.executeKw<OdooTemplate[]>(
        'product.template',
        'search_read',
        [
          [
            ['sale_ok', '=', true],
            ['bt_storefront_slug', '!=', false],
          ],
        ],
        {
          fields: templateFields,
          order: 'name asc',
        },
      );
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('Invalid field') && !msg.includes('does not exist')) {
        throw err;
      }
      this.logger.warn(
        'bt_application_tags/bt_viscosity missing on Odoo — upgrade black_tiger_base. Loading without taxonomy fields.',
      );
      templates = await this.odoo.executeKw<OdooTemplate[]>(
        'product.template',
        'search_read',
        [
          [
            ['sale_ok', '=', true],
            ['bt_storefront_slug', '!=', false],
          ],
        ],
        {
          fields: templateFields.filter(
            (f) => f !== 'bt_application_tags' && f !== 'bt_viscosity',
          ),
          order: 'name asc',
        },
      );
    }

    const tmplIds = templates.map((t) => t.id);
    const baseUrl = (this.config.get<string>('ODOO_URL') || 'http://localhost:8069').replace(
      /\/$/,
      '',
    );

    const [
      variants,
      benefits,
      specifications,
      typicals,
      oemLines,
      galleryImages,
      documents,
      pricelistItems,
    ] = await Promise.all([
      this.loadVariants(tmplIds),
      this.loadChildLines<OdooBenefit>('bt.product.benefit', tmplIds, ['name', 'sequence']),
      this.loadChildLines<OdooSpecification>('bt.product.specification', tmplIds, [
        'name',
        'sequence',
      ]),
      this.loadChildLines<OdooTypical>('bt.product.typical', tmplIds, [
        'test',
        'method',
        'unit',
        'value',
        'sequence',
      ]),
      this.loadChildLines<OdooOemLine>('bt.product.oem.line', tmplIds, [
        'brand',
        'product_name',
        'sequence',
      ]),
      this.loadChildLines<OdooGalleryImage>('bt.product.image', tmplIds, [
        'id',
        'name',
        'sequence',
        'product_id',
      ]),
      this.loadChildLines<OdooDocument>('bt.product.document', tmplIds, [
        'doc_type',
        'name',
        'sequence',
      ]),
      this.loadPublicPricelistItems(tmplIds),
    ]);

    const variantsByTmpl = groupByTmplId(variants);
    const benefitsByTmpl = groupByTmplId(benefits);
    const specificationsByTmpl = groupByTmplId(specifications);
    const typicalsByTmpl = groupByTmplId(typicals);
    const oemByTmpl = groupByTmplId(oemLines);
    const galleryByTmpl = groupByTmplId(galleryImages);
    const documentsByTmpl = groupByTmplId(documents);
    const pricelistByTmpl = groupByTmplId(
      pricelistItems.filter(
        (item): item is OdooPricelistItem & { product_tmpl_id: [number, string] } =>
          Array.isArray(item.product_tmpl_id),
      ),
    );

    const productsBySlug: Record<string, ProductFixture> = {};
    const slugByTmplId = new Map<number, string>();

    for (const t of templates) {
      const slug = (t.bt_storefront_slug || '').trim();
      if (!slug) {
        continue;
      }
      slugByTmplId.set(t.id, slug);
      const cat = resolveProductCategory(t.categ_id, categoriesById, categoriesBySlug);
      const currency = 'SAR';
      const pricingNotices = {
        partial: t.bt_pricing_notice_partial ? String(t.bt_pricing_notice_partial) : undefined,
        full: t.bt_pricing_notice_full ? String(t.bt_pricing_notice_full) : undefined,
      };
      const tmplPricelist = pricelistByTmpl.get(t.id) ?? [];
      const tmplGallery = galleryByTmpl.get(t.id) ?? [];
      const packagingOptions = buildPackagingOptions(
        t,
        variantsByTmpl.get(t.id) ?? [],
        tmplPricelist,
        currency,
        pricingNotices,
        tmplGallery,
        baseUrl,
      );
      const defaultPkg =
        packagingOptions.find((o) => o.default) ?? packagingOptions[0];
      const unitPrice = defaultPkg?.unitPrice ?? t.list_price ?? 0;
      const templatePalletPricing = buildPalletPricing(
        tmplPricelist.filter((item) => !item.product_id),
        currency,
        pricingNotices,
      );
      const defaultPalletPricing =
        defaultPkg?.pricing && typeof defaultPkg.pricing === 'object'
          ? {
              partialPallet: (defaultPkg.pricing as Record<string, unknown>).partialPallet,
              fullPallet: (defaultPkg.pricing as Record<string, unknown>).fullPallet,
            }
          : templatePalletPricing;
      const inStock = (t.qty_available ?? 1) > 0;
      const mainImageUrl = `${baseUrl}/web/image/product.template/${t.id}/image_128`;
      const gallery = buildGallery(
        templateWideGallery(tmplGallery),
        mainImageUrl,
        t.name,
        baseUrl,
      );

      productsBySlug[slug] = {
        id: String(t.id),
        slug,
        name: t.name,
        productCode: (t.default_code && String(t.default_code)) || slug,
        categorySlug: cat.slug,
        categoryLabel: cat.label,
        segmentTags: parseSegmentTags(t.bt_segment_tags),
        applicationTags: parseSegmentTags(t.bt_application_tags ?? false),
        productLine: t.bt_product_line ? String(t.bt_product_line) : undefined,
        viscosity: t.bt_viscosity ? String(t.bt_viscosity).trim().toLowerCase() : undefined,
        shortDescription: t.description_sale
          ? String(t.description_sale)
          : undefined,
        subtitle: t.bt_subtitle ? String(t.bt_subtitle) : undefined,
        sizeLabel: t.bt_size_label ? String(t.bt_size_label) : undefined,
        imageUrl: mainImageUrl,
        gallery,
        unitPrice,
        currency,
        inStock,
        packagingOptions,
        pricing: buildPricing(unitPrice, currency, packagingOptions, defaultPalletPricing),
        descriptionHtml: resolveDescriptionHtml(t),
        benefits: (benefitsByTmpl.get(t.id) ?? []).map((b) => b.name),
        specifications: (specificationsByTmpl.get(t.id) ?? []).map((s) => s.name),
        typicals: (typicalsByTmpl.get(t.id) ?? []).map((row) => ({
          test: row.test,
          method: row.method ? String(row.method) : '',
          unit: row.unit ? String(row.unit) : '',
          value: row.value,
        })),
        oemCrossReference: (oemByTmpl.get(t.id) ?? []).map((row) => ({
          brand: row.brand,
          productName: row.product_name,
        })),
        documents: (documentsByTmpl.get(t.id) ?? []).map((doc) => ({
          type: doc.doc_type as 'pds' | 'sds' | 'other',
          title: doc.name,
          url: `${baseUrl}/web/content/bt.product.document/${doc.id}/file?download=true`,
        })),
        relatedSlugs: [],
      };
    }

    for (const t of templates) {
      const slug = slugByTmplId.get(t.id);
      if (!slug || !productsBySlug[slug]) {
        continue;
      }
      const relatedIds = Array.isArray(t.bt_related_product_ids)
        ? t.bt_related_product_ids
        : [];
      const curated = relatedIds
        .map((id) => slugByTmplId.get(id))
        .filter((s): s is string => Boolean(s && productsBySlug[s]));
      if (curated.length > 0) {
        productsBySlug[slug].relatedSlugs = curated;
        continue;
      }
      productsBySlug[slug].relatedSlugs = Object.values(productsBySlug)
        .filter(
          (other) =>
            other.slug !== slug && other.categorySlug === productsBySlug[slug].categorySlug,
        )
        .slice(0, 4)
        .map((o) => o.slug);
    }

    const featuredSlugs = Object.values(productsBySlug)
      .sort((a, b) => {
        const lineScore = (p: ProductFixture) => (p.slug.includes('tiger-x') ? 0 : 1);
        return lineScore(a) - lineScore(b) || a.name.localeCompare(b.name);
      })
      .slice(0, 3)
      .map((p) => p.slug);

    this.logger.log(
      `Loaded ${Object.keys(productsBySlug).length} product(s), ${Object.keys(categoriesBySlug).length} categor(ies) from Odoo`,
    );

    return { productsBySlug, categoryTree, categoriesBySlug, featuredSlugs };
  }

  private async loadVariants(tmplIds: number[]): Promise<OdooVariant[]> {
    if (!tmplIds.length) {
      return [];
    }
    try {
      return await this.odoo.executeKw<OdooVariant[]>(
        'product.product',
        'search_read',
        [[['product_tmpl_id', 'in', tmplIds]]],
        {
          fields: [
            'display_name',
            'default_code',
            'product_tmpl_id',
            'list_price',
            'lst_price',
            'price_extra',
            'bt_storefront_sale',
          ],
          order: 'id asc',
        },
      );
    } catch {
      return await this.odoo.executeKw<OdooVariant[]>(
        'product.product',
        'search_read',
        [[['product_tmpl_id', 'in', tmplIds]]],
        {
          fields: ['display_name', 'default_code', 'product_tmpl_id', 'list_price', 'lst_price', 'price_extra'],
          order: 'id asc',
        },
      );
    }
  }

  private async loadChildLines<T extends { product_tmpl_id: [number, string] }>(
    model: string,
    tmplIds: number[],
    fields: string[],
  ): Promise<T[]> {
    if (!tmplIds.length) {
      return [];
    }
    try {
      return await this.odoo.executeKw<T[]>(
        model,
        'search_read',
        [[['product_tmpl_id', 'in', tmplIds]]],
        {
          fields: ['product_tmpl_id', ...fields],
          order: 'product_tmpl_id, sequence, id',
        },
      );
    } catch (err) {
      this.logger.warn(`Could not load ${model} from Odoo: ${String(err)}`);
      return [];
    }
  }

  private async loadPublicPricelistItems(tmplIds: number[]): Promise<OdooPricelistItem[]> {
    if (!tmplIds.length) {
      return [];
    }
    try {
      const lists = await this.odoo.executeKw<Array<{ id: number }>>(
        'product.pricelist',
        'search_read',
        [[['name', '=', 'Public SAR']]],
        { fields: ['id'], limit: 1 },
      );
      const list = lists[0];
      if (!list) {
        return [];
      }
      return await this.odoo.executeKw<OdooPricelistItem[]>(
        'product.pricelist.item',
        'search_read',
        [
          [
            ['pricelist_id', '=', list.id],
            ['bt_pallet_type', 'in', ['partial', 'full']],
            '|',
            ['product_tmpl_id', 'in', tmplIds],
            ['product_id.product_tmpl_id', 'in', tmplIds],
          ],
        ],
        {
          fields: [
            'product_tmpl_id',
            'product_id',
            'fixed_price',
            'bt_pallet_type',
            'bt_box_qty',
            'bt_pallet_qty',
            'bt_boxes_per_pallet',
          ],
          order: 'product_tmpl_id, min_quantity',
        },
      );
    } catch (err) {
      this.logger.warn(`Could not load pricelist tiers from Odoo: ${String(err)}`);
      return [];
    }
  }

  private async loadCategories(): Promise<OdooCategory[]> {
    const fullFields = [
      'name',
      'parent_id',
      'bt_storefront_slug',
      'bt_show_in_storefront',
      'bt_plp_eyebrow',
      'bt_plp_title',
      'bt_plp_body',
      'bt_plp_cta_label',
      'bt_plp_cta_href',
      'bt_plp_image_url',
    ];
    try {
      return await this.odoo.executeKw<OdooCategory[]>(
        'product.category',
        'search_read',
        [[]],
        { fields: fullFields, order: 'name asc' },
      );
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('Invalid field') && !msg.includes('does not exist')) {
        throw err;
      }
      this.logger.warn(
        'Black Tiger category fields missing on Odoo — upgrade black_tiger_base. Using name/parent_id only.',
      );
      const basic = await this.odoo.executeKw<
        Array<{ id: number; name: string; parent_id: [number, string] | false }>
      >('product.category', 'search_read', [[]], {
        fields: ['name', 'parent_id'],
        order: 'name asc',
      });
      return basic.map((c) => ({
        ...c,
        bt_storefront_slug: slugifyName(c.name),
        bt_show_in_storefront: !c.parent_id,
        bt_plp_eyebrow: false,
        bt_plp_title: false,
        bt_plp_body: false,
        bt_plp_cta_label: false,
        bt_plp_cta_href: false,
        bt_plp_image_url: false,
      }));
    }
  }
}

function buildCategoryViews(categories: OdooCategory[]): {
  categoriesBySlug: Record<string, CatalogCategoryDetail>;
  categoryTree: CatalogCategoryTree;
} {
  const categoriesBySlug: Record<string, CatalogCategoryDetail> = {};

  for (const c of categories) {
    const slug = categorySlug(c);
    if (!slug) {
      continue;
    }
    const displayName = (c.bt_plp_title && String(c.bt_plp_title)) || c.name;
    const detail: CatalogCategoryDetail = {
      slug,
      name: displayName.toUpperCase(),
      href: `/products/${slug}`,
    };
    const banner = buildBanner(c, displayName);
    if (banner) {
      detail.banner = banner;
    }
    categoriesBySlug[slug] = detail;
  }

  const navChildren = categories
    .filter((c) => {
      const slug = categorySlug(c);
      return Boolean(slug && categoriesBySlug[slug] && c.parent_id);
    })
    .map((c) => {
      const slug = categorySlug(c)!;
      const d = categoriesBySlug[slug];
      return {
        slug,
        name: d.name,
        href: d.href,
        children: [] as [],
      };
    });

  const categoryTree: CatalogCategoryTree = {
    categories: [
      {
        slug: STORE_ROOT.slug,
        name: STORE_ROOT.name,
        children: navChildren,
      },
    ],
  };

  return { categoriesBySlug, categoryTree };
}

function buildBanner(
  c: OdooCategory,
  displayName: string,
): CatalogCategoryBanner | undefined {
  const hasCopy =
    c.bt_plp_eyebrow ||
    c.bt_plp_title ||
    c.bt_plp_body ||
    c.bt_plp_image_url;
  if (!hasCopy) {
    return undefined;
  }
  const banner: CatalogCategoryBanner = {};
  if (c.bt_plp_eyebrow) {
    banner.eyebrow = String(c.bt_plp_eyebrow);
  }
  if (c.bt_plp_title) {
    banner.title = String(c.bt_plp_title);
  } else {
    banner.title = displayName;
  }
  if (c.bt_plp_body) {
    banner.body = String(c.bt_plp_body);
  }
  if (c.bt_plp_cta_label || c.bt_plp_cta_href) {
    banner.ctaLabel = c.bt_plp_cta_label ? String(c.bt_plp_cta_label) : undefined;
    banner.ctaHref = c.bt_plp_cta_href ? String(c.bt_plp_cta_href) : undefined;
  }
  if (c.bt_plp_image_url) {
    banner.image = {
      url: String(c.bt_plp_image_url),
      alt: displayName,
    };
  }
  return banner;
}

function resolveProductCategory(
  categRef: [number, string] | false,
  categoriesById: Map<number, OdooCategory>,
  categoriesBySlug: Record<string, CatalogCategoryDetail>,
): { slug: string; label: string } {
  if (!categRef) {
    return { slug: 'uncategorized', label: 'PRODUCTS' };
  }
  let currentId: number | null = categRef[0];
  const visited = new Set<number>();
  let leaf: { slug: string; label: string } | null = null;

  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const node = categoriesById.get(currentId);
    if (!node) {
      break;
    }
    const slug = categorySlug(node);
    if (slug) {
      leaf = {
        slug,
        label: categoriesBySlug[slug]?.name ?? node.name.toUpperCase(),
      };
      if (categoriesBySlug[slug]) {
        return leaf;
      }
    }
    currentId = node.parent_id ? node.parent_id[0] : null;
  }

  if (leaf) {
    return leaf;
  }

  const fallbackSlug = slugifyName(categRef[1]);
  return {
    slug: fallbackSlug,
    label: categRef[1].toUpperCase(),
  };
}

function categorySlug(c: Pick<OdooCategory, 'name' | 'bt_storefront_slug'>): string {
  const explicit = c.bt_storefront_slug && String(c.bt_storefront_slug).trim();
  if (explicit) {
    return explicit;
  }
  return slugifyName(c.name);
}

function parseSegmentTags(raw: string | false): string[] {
  if (!raw) {
    return [];
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function groupByTmplId<T extends { product_tmpl_id: [number, string] }>(
  rows: T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const id = row.product_tmpl_id[0];
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

function packagingLabel(displayName: string, productName: string): string {
  const marker = '(';
  const idx = displayName.lastIndexOf(marker);
  if (idx >= 0 && displayName.endsWith(')')) {
    return displayName.slice(idx + 1, -1).trim();
  }
  return displayName.replace(productName, '').trim() || displayName;
}

function variantListUnitPrice(
  v: OdooVariant,
  tmpl: OdooTemplate,
  scoped: OdooPricelistItem[],
): number {
  const tmplBase = tmpl.list_price ?? 0;
  const fromExtra =
    typeof v.price_extra === 'number' ? tmplBase + v.price_extra : 0;
  const partialItems = scoped
    .filter((item) => item.bt_pallet_type === 'partial')
    .sort(
      (a, b) => (Number(a.bt_box_qty) || 0) - (Number(b.bt_box_qty) || 0),
    );
  const minPartial = partialItems[0];
  const tierUnit = minPartial ? Number(minPartial.fixed_price) || 0 : 0;
  if (tierUnit > 0) {
    return tierUnit;
  }
  if (fromExtra > 0) {
    return fromExtra;
  }
  if (typeof v.lst_price === 'number' && v.lst_price > 0) {
    return v.lst_price;
  }
  if (typeof v.list_price === 'number' && v.list_price > 0) {
    return v.list_price;
  }
  return tmplBase;
}

function buildPackagingOptions(
  tmpl: OdooTemplate,
  variants: OdooVariant[],
  pricelistItems: OdooPricelistItem[],
  currency: string,
  notices: { partial?: string; full?: string },
  galleryImages: OdooGalleryImage[] = [],
  baseUrl = '',
): ProductFixture['packagingOptions'] {
  const mediaByVariantId = galleryByVariantId(galleryImages, baseUrl, tmpl.name);

  if (variants.length > 1) {
    return variants.map((v, idx) => {
      const variantItems = pricelistItems.filter(
        (item) => Array.isArray(item.product_id) && item.product_id[0] === v.id,
      );
      const tmplItems = pricelistItems.filter(
        (item) =>
          !item.product_id &&
          Array.isArray(item.product_tmpl_id) &&
          item.product_tmpl_id[0] === tmpl.id,
      );
      const scoped = variantItems.length > 0 ? variantItems : tmplItems;
      const unitPrice = variantListUnitPrice(v, tmpl, scoped);
      const safeUnitPrice = unitPrice > 0 ? unitPrice : tmpl.list_price ?? 0;
      const palletPricing = buildPalletPricing(scoped, currency, notices);
      const media = mediaByVariantId.get(v.id);
      const option: PackagingFixture = {
        id: `pkg-${v.id}`,
        label: packagingLabel(v.display_name || tmpl.name, tmpl.name),
        sku: v.default_code ? String(v.default_code) : undefined,
        default: idx === 0,
        unitPrice: safeUnitPrice,
        pricing: {
          unitPrice: safeUnitPrice,
          formattedUnitPrice: formatMoney(safeUnitPrice, currency),
          ...palletPricing,
        },
      };
      if (media?.length) {
        option.media = media;
        option.image = media[0];
      }
      if (v.bt_storefront_sale) {
        option.badges = ['sale'];
      }
      return option;
    });
  }
  const unitPrice = tmpl.list_price ?? 0;
  const tmplItems = pricelistItems.filter(
    (item) =>
      !item.product_id &&
      Array.isArray(item.product_tmpl_id) &&
      item.product_tmpl_id[0] === tmpl.id,
  );
  const palletPricing = buildPalletPricing(tmplItems, currency, notices);
  return [
    {
      id: `pkg-${tmpl.id}-default`,
      label: 'Standard',
      sku: tmpl.default_code ? String(tmpl.default_code) : undefined,
      default: true,
      unitPrice,
      pricing: {
        unitPrice,
        formattedUnitPrice: formatMoney(unitPrice, currency),
        ...palletPricing,
      },
    },
  ];
}

function formatMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function buildPalletPricing(
  items: OdooPricelistItem[],
  currency: string,
  notices: { partial?: string; full?: string },
): Record<string, unknown> {
  const partialRows = items
    .filter((item) => item.bt_pallet_type === 'partial')
    .map((item) => {
      const boxQty = Number(item.bt_box_qty) || 0;
      const unit = Number(item.fixed_price) || 0;
      const ext = boxQty * unit;
      return {
        boxQty,
        unitPrice: formatMoney(unit, currency),
        extPrice: formatMoney(ext, currency),
      };
    });
  const fullRows = items
    .filter((item) => item.bt_pallet_type === 'full')
    .map((item) => {
      const palletQty = Number(item.bt_pallet_qty) || 0;
      const boxPerPallet = Number(item.bt_boxes_per_pallet) || 0;
      const totalBoxQty = palletQty * boxPerPallet;
      const unit = Number(item.fixed_price) || 0;
      const ext = totalBoxQty * unit;
      return {
        palletQty,
        boxPerPallet,
        totalBoxQty,
        unitPrice: formatMoney(unit, currency),
        extPrice: formatMoney(ext, currency),
      };
    });

  const result: Record<string, unknown> = {};
  if (partialRows.length) {
    result.partialPallet = {
      title: 'Price Per Partial Pallet',
      columns: ['Box QTY', 'Unit Price', 'EXT Price'],
      rows: partialRows,
      notice: notices.partial,
    };
  }
  if (fullRows.length) {
    result.fullPallet = {
      title: 'Price Per Full Pallet',
      columns: ['Pallet QTY', 'Box Per Pallet', 'Total Box QTY', 'Unit Price', 'EXT Price'],
      rows: fullRows,
      notice: notices.full,
    };
  }
  return result;
}

function buildPricing(
  unitPrice: number,
  currency: string,
  packagingOptions: ProductFixture['packagingOptions'],
  palletPricing: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    currency,
    unitPrice,
    formattedTotal: `${unitPrice.toLocaleString('en-SA')} SAR`,
    formattedUnitPrice: `${unitPrice.toLocaleString('en-SA')} ${currency}`,
    lineSummary: {
      packagingLabel: packagingOptions[0]?.label ?? '',
      palletType: 'unit',
      quantity: 1,
      unitPrice,
      extendedPrice: unitPrice,
      totalPrice: unitPrice,
      currency,
    },
    ...palletPricing,
  };
}

function resolveDescriptionHtml(t: OdooTemplate): string | undefined {
  if (t.bt_description_html) {
    return String(t.bt_description_html);
  }
  if (t.description_sale) {
    return `<p>${escapeHtml(String(t.description_sale))}</p>`;
  }
  return undefined;
}

function templateWideGallery(images: OdooGalleryImage[]): OdooGalleryImage[] {
  return images.filter((image) => !Array.isArray(image.product_id));
}

function galleryMediaItem(
  image: OdooGalleryImage,
  baseUrl: string,
  fallbackAlt: string,
): { url: string; alt: string } {
  return {
    url: `${baseUrl}/web/image/bt.product.image/${image.id}/image`,
    alt: image.name || fallbackAlt,
  };
}

/** Map packaging variant id → ordered media slides. */
function galleryByVariantId(
  images: OdooGalleryImage[],
  baseUrl: string,
  fallbackAlt: string,
): Map<number, Array<{ url: string; alt: string }>> {
  const byVariant = new Map<number, Array<{ url: string; alt: string }>>();
  const sorted = [...images].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id - b.id);
  for (const image of sorted) {
    if (!Array.isArray(image.product_id)) continue;
    const variantId = image.product_id[0];
    const list = byVariant.get(variantId) ?? [];
    list.push(galleryMediaItem(image, baseUrl, fallbackAlt));
    byVariant.set(variantId, list);
  }
  return byVariant;
}

function buildGallery(
  images: OdooGalleryImage[],
  mainImageUrl: string,
  name: string,
  baseUrl: string,
): Array<{ url: string; alt: string }> {
  if (!images.length) {
    return [{ url: mainImageUrl, alt: name }];
  }
  return images.map((image) => galleryMediaItem(image, baseUrl, name));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
