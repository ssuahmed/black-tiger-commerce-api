/** Known signatures of M1 mock/fixture data — must not appear when ODOO_MODE=live. */

export const MOCK_PACKAGING_ID_PREFIX = 'pkg-box-';
export const MOCK_IMAGE_HOST = 'placehold.co';
export const MOCK_ORDER_PREFIX = 'BT-M1-';

export type ProductLike = {
  packagingOptions?: Array<{ id?: string }>;
  imageUrl?: string;
  gallery?: Array<{ url?: string }>;
};

export function hasMockPackagingId(packagingOptionId: string): boolean {
  return packagingOptionId.startsWith(MOCK_PACKAGING_ID_PREFIX);
}

export function productLooksLikeMock(product: ProductLike): boolean {
  const pkgMock = product.packagingOptions?.some((p) =>
    hasMockPackagingId(p.id ?? ''),
  );
  const img = product.imageUrl ?? '';
  const galleryMock = product.gallery?.some((g) =>
    (g.url ?? '').includes(MOCK_IMAGE_HOST),
  );
  return Boolean(pkgMock || img.includes(MOCK_IMAGE_HOST) || galleryMock);
}

export function orderNumberLooksLikeMock(orderNumber: string): boolean {
  return orderNumber.startsWith(MOCK_ORDER_PREFIX);
}

export function packagingIdLooksLikeOdoo(packagingOptionId: string): boolean {
  return /^pkg-\d+$/.test(packagingOptionId);
}
