import { MOCK_CATEGORY_TREE } from './catalog.fixtures';
import type { CatalogCategoryDetail } from '../infrastructure/odoo/odoo-catalog.loader';

const DEFAULT_BANNER = {
  eyebrow: 'TECHNOLOGY',
  title: 'ADAPTIVE SHIELD TECHNOLOGY',
  body: 'Our Adaptive Shield Technology helps break new ground in engine performance. The technology is a combination of additive chemistries that shield engine parts from internal and external factors, by creating a robust shield against the extreme pressures, temperatures and shear forces affecting a broad range of engines.',
  ctaLabel: 'LEARN MORE',
  ctaHref: '/about',
};

export function buildMockCategoriesBySlug(): Record<string, CatalogCategoryDetail> {
  const out: Record<string, CatalogCategoryDetail> = {};
  for (const child of MOCK_CATEGORY_TREE.categories[0]?.children ?? []) {
    out[child.slug] = {
      slug: child.slug,
      name: child.name,
      href: child.href,
      banner: {
        ...DEFAULT_BANNER,
        image: {
          url: `https://placehold.co/1200x400/222/fafafa/png?text=${encodeURIComponent(child.name)}`,
          alt: child.name,
        },
      },
    };
  }
  return out;
}
