/**
 * Storefront catalog domain: categories, PLP listing/filtering, PDP detail,
 * featured products, search, and packaging price quotes.
 *
 * Reads product/category snapshots via {@link CatalogProductsProvider}
 * (Odoo + Redis cache when live, mock fixtures otherwise). Does not call
 * Odoo directly — pricing and taxonomy helpers stay pure against the snapshot.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  buildFacets,
  productToCard,
  type ProductFixture,
} from '../../mocks/catalog.fixtures';
import type {
  CatalogCategoryDetail,
  CatalogCategoryTree,
} from '../../infrastructure/odoo/odoo-catalog.loader';
import { CatalogProductsProvider } from './catalog-products.provider';
import { buildProductDetailResponse } from './product-pdp.mapper';
import {
  resolvePackagingPricing,
  resolveQuoteUnitPrice,
} from './catalog-pricing';
import { matchesTaxonomyFacet } from './catalog-taxonomy';

/** Breadcrumb trail for a category PLP page. */
function categoryBreadcrumbs(slug: string, name: string) {
  return [
    { label: 'HOME', href: '/' },
    { label: 'PRODUCTS', href: '/products' },
    { label: name, href: `/products/${slug}` },
  ];
}

function findCategoryInTree(
  tree: CatalogCategoryTree,
  slug: string,
): { slug: string; name: string } | null {
  for (const root of tree.categories) {
    for (const child of root.children ?? []) {
      if (child.slug === slug) {
        return { slug: child.slug, name: child.name };
      }
    }
  }
  return null;
}

function resolveCategoryPage(
  slug: string,
  categoriesBySlug: Record<string, CatalogCategoryDetail>,
  categoryTree: CatalogCategoryTree,
): {
  slug: string;
  name: string;
  breadcrumbs: Array<{ label: string; href: string }>;
  banner?: Record<string, unknown>;
} | null {
  const detail = categoriesBySlug[slug];
  if (detail) {
    return {
      slug: detail.slug,
      name: detail.name,
      breadcrumbs: categoryBreadcrumbs(detail.slug, detail.name),
      banner: detail.banner as Record<string, unknown> | undefined,
    };
  }
  const inTree = findCategoryInTree(categoryTree, slug);
  if (inTree) {
    return {
      slug: inTree.slug,
      name: inTree.name,
      breadcrumbs: categoryBreadcrumbs(inTree.slug, inTree.name),
    };
  }
  return null;
}

function matchesCategory(p: ProductFixture, categorySlug: string): boolean {
  if (p.categorySlug === categorySlug) {
    return true;
  }
  const tags = p.segmentTags ?? [];
  if (tags.includes(categorySlug)) {
    return true;
  }
  return p.categorySlug.endsWith(`-${categorySlug}`);
}

function matchesFacet(p: ProductFixture, key: string, values: string[]): boolean {
  return matchesTaxonomyFacet(p, key, values);
}

@Injectable()
export class CatalogService {
  constructor(private readonly catalog: CatalogProductsProvider) {}

  /** Category tree for storefront nav (includes `dataSource`: odoo | mock). */
  async listCategories() {
    const { categoryTree, source } = await this.catalog.getSnapshot();
    return { ...categoryTree, dataSource: source };
  }

  /** Category detail page metadata (banner, breadcrumbs) by slug. */
  async getCategoryBySlug(slug: string) {
    const { categoryTree, categoriesBySlug } = await this.catalog.getSnapshot();
    const row = resolveCategoryPage(slug, categoriesBySlug, categoryTree);
    if (!row) {
      throw new NotFoundException('Category not found');
    }
    return row;
  }

  /**
   * Product listing page: filter by category/search/facets, sort, cursor-paginate,
   * and return facet counts scoped to the active segment.
   */
  async listProducts(query: Record<string, string | string[] | undefined>) {
    const { productsBySlug, categoryTree, categoriesBySlug } =
      await this.catalog.getSnapshot();
    let items = Object.values(productsBySlug);
    const categorySlug =
      typeof query.category === 'string' ? query.category : undefined;
    if (categorySlug) {
      items = items.filter((p) => matchesCategory(p, categorySlug));
    }
    const q =
      typeof query.q === 'string'
        ? query.q
        : Array.isArray(query.q)
          ? String(query.q[0] ?? '')
          : '';
    if (q.trim()) {
      items = items.filter((p) => matchesSearchQuery(p, q));
    }
    const viscosity = normalizeArr(query.viscosity);
    const segment = normalizeArr(query.segment);
    const application = normalizeArr(query.application);
    const segmentApplication = normalizeArr(query.segmentApplication);
    const productLine = normalizeArr(query.productLine);
    /** Category path acts as the active segment for facet scoping + filtering. */
    const activeSegments = [
      ...new Set(
        [...(categorySlug ? [categorySlug] : []), ...segment].filter(Boolean),
      ),
    ];
    items = items.filter(
      (p) =>
        matchesFacet(p, 'viscosity', viscosity) &&
        matchesFacet(p, 'segment', segment) &&
        matchesFacet(p, 'application', application) &&
        matchesFacet(p, 'segmentApplication', segmentApplication) &&
        matchesFacet(p, 'productLine', productLine),
    );
    const sort =
      typeof query.sort === 'string' ? query.sort : 'relevance';
    items = [...items].sort((a, b) => compareSort(a, b, sort));
    const pageSize = clampInt(query.pageSize, 32, 1, 48);
    const cursorIdx =
      typeof query.cursor === 'string' ? decodeCursor(query.cursor) : 0;
    const slice = items.slice(cursorIdx, cursorIdx + pageSize);
    const loaded = cursorIdx + slice.length;
    const hasMore = loaded < items.length;
    const catMeta =
      categorySlug &&
      resolveCategoryPage(categorySlug, categoriesBySlug, categoryTree)
        ? resolveCategoryPage(categorySlug, categoriesBySlug, categoryTree)!
        : {
            slug: 'all',
            name: 'ALL PRODUCTS',
            breadcrumbs: [
              { label: 'HOME', href: '/' },
              { label: 'PRODUCTS', href: '/products' },
            ],
          };
    return {
      category: {
        slug: catMeta.slug,
        name: catMeta.name,
        banner: catMeta.banner ?? null,
      },
      breadcrumbs: catMeta.breadcrumbs,
      activeFilters: [],
      facets: buildFacets(Object.values(productsBySlug), {
        activeSegments,
      }),
      items: slice.map(productToCard),
      pagination: {
        pageSize,
        total: items.length,
        loaded,
        hasMore,
        nextCursor: hasMore ? encodeCursor(loaded) : null,
      },
      view:
        typeof query.view === 'string' && query.view === 'grid'
          ? 'grid'
          : 'list',
    };
  }

  /** Product detail page payload mapped for the storefront PDP. */
  async getProductDetail(slug: string) {
    const { productsBySlug, source } = await this.catalog.getSnapshot();
    const p = productsBySlug[slug];
    if (!p) {
      throw new NotFoundException('Product not found');
    }
    return { ...buildProductDetailResponse(p, productsBySlug), dataSource: source };
  }

  /**
   * Live line-price for a packaging + pallet type + quantity selection
   * (used by PDP before add-to-cart).
   */
  async priceQuote(
    slug: string,
    body: {
      packagingOptionId: string;
      quantity: number;
      palletType?: 'full' | 'partial' | 'unit';
    },
  ) {
    const p = await this.catalog.getProduct(slug);
    if (!p) {
      throw new NotFoundException('Product not found');
    }
    const pkg = p.packagingOptions.find((x) => x.id === body.packagingOptionId);
    if (!pkg) {
      throw new NotFoundException('Packaging option not found');
    }
    const palletType = body.palletType ?? 'unit';
    const unitPrice = resolveQuoteUnitPrice(
      p,
      palletType,
      body.quantity,
      body.packagingOptionId,
    );
    const scopedPricing = resolvePackagingPricing(p, body.packagingOptionId);
    const qty = body.quantity;
    const extended = unitPrice * qty;
    const lineSummary = {
      packagingLabel: pkg.label,
      palletType,
      quantity: qty,
      unitPrice,
      extendedPrice: extended,
      totalPrice: extended,
      currency: p.currency,
    };
    return {
      lineSummary,
      pricing: {
        ...p.pricing,
        ...scopedPricing,
        // Pallet tiers are variant-scoped: an absent tier on the selected packaging
        // must not inherit the template table.
        partialPallet: scopedPricing.partialPallet ?? null,
        fullPallet: scopedPricing.fullPallet ?? null,
        unitPrice,
        formattedUnitPrice: `${unitPrice.toLocaleString('en-SA')} ${p.currency}`,
        formattedTotal: `${extended.toLocaleString('en-SA')} ${p.currency}`,
        lineSummary,
      },
    };
  }

  /** Homepage / promo featured product cards. */
  async featured() {
    const { productsBySlug, featuredSlugs } = await this.catalog.getSnapshot();
    return featuredSlugs
      .map((s) => productsBySlug[s])
      .filter(Boolean)
      .map(productToCard);
  }

  /** Simple typeahead/search over name, code, tags, and labels. */
  async search(q: string) {
    const items = await this.catalog.getAllProducts();
    const matches =
      q.trim().length > 0 ? items.filter((p) => matchesSearchQuery(p, q)) : [];
    return {
      query: q,
      items: matches.map(productToCard),
      pagination: {
        pageSize: matches.length,
        total: matches.length,
        loaded: matches.length,
        hasMore: false,
        nextCursor: null as string | null,
      },
    };
  }
}

/** Case-insensitive match on name, product code, slug, and category labels. */
export function matchesSearchQuery(p: ProductFixture, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    p.name,
    p.productCode,
    p.slug,
    p.categorySlug,
    p.categoryLabel,
    p.shortDescription,
    p.subtitle,
    p.sizeLabel,
    ...(Array.isArray(p.segmentTags) ? p.segmentTags : []),
    ...(Array.isArray(p.applicationTags) ? p.applicationTags : []),
    p.productLine,
    p.viscosity,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function normalizeArr(v: string | string[] | undefined): string[] {
  if (!v) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

function clampInt(
  raw: string | string[] | undefined,
  def: number,
  min: number,
  max: number,
): number {
  const s = typeof raw === 'string' ? raw : def;
  const n = Number.parseInt(String(s), 10);
  if (Number.isNaN(n)) {
    return def;
  }
  return Math.min(max, Math.max(min, n));
}

function encodeCursor(n: number): string {
  return Buffer.from(String(n), 'utf8').toString('base64url');
}

function decodeCursor(c: string): number {
  try {
    const v = Buffer.from(c, 'base64url').toString('utf8');
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  } catch {
    return 0;
  }
}

function compareSort(
  a: ProductFixture,
  b: ProductFixture,
  sort: string,
): number {
  switch (sort) {
    case 'name_asc':
      return a.name.localeCompare(b.name);
    case 'name_desc':
      return b.name.localeCompare(a.name);
    case 'price_asc':
      return a.unitPrice - b.unitPrice;
    case 'price_desc':
      return b.unitPrice - a.unitPrice;
    default:
      return 0;
  }
}
