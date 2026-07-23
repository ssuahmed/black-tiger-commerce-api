/**
 * Live integration tests — require running API + Odoo (ODOO_MODE=live).
 * Run: RUN_LIVE_TESTS=1 npm run test:e2e -- live-integration.e2e-spec.ts
 */
import request from 'supertest';
import {
  hasMockPackagingId,
  orderNumberLooksLikeMock,
  productLooksLikeMock,
} from '../src/common/integration/mock-markers';

const RUN = process.env.RUN_LIVE_TESTS === '1';
const API_BASE = (process.env.API_BASE || 'http://localhost:3001').replace(/\/$/, '');

function data<T>(body: { data?: T }): T {
  return body.data as T;
}

(RUN ? describe : describe.skip)('Live integration (external API)', () => {
  jest.setTimeout(120_000);

  it('ready probe reports odoo sources without mock markers', async () => {
    const res = await request(API_BASE).get('/ready').expect(200);
    const ready = data<{
      status: string;
      integration: {
        odooMode: string;
        sources: { catalog: string; content: string; shipping: string };
        checks: { mockCatalogMarkers: boolean; catalogProductCount: number };
        issues: string[];
      };
    }>(res.body);
    expect(ready.integration.odooMode).toBe('live');
    expect(ready.status).toBe('ready');
    expect(ready.integration.sources.catalog).toBe('odoo');
    expect(ready.integration.sources.content).toBe('odoo');
    expect(ready.integration.checks.mockCatalogMarkers).toBe(false);
    expect(ready.integration.checks.catalogProductCount).toBeGreaterThan(0);
    expect(ready.integration.issues).toEqual([]);
  });

  it('catalog products are not mock fixtures', async () => {
    const res = await request(API_BASE)
      .get('/v1/catalog/products/tiger-x-5w30-sn')
      .expect(200);
    const product = data<{
      dataSource: string;
      packagingOptions: Array<{ id: string }>;
      imageUrl: string;
    }>(res.body);
    expect(product.dataSource).toBe('odoo');
    expect(productLooksLikeMock(product)).toBe(false);
    expect(hasMockPackagingId(product.packagingOptions[0]?.id ?? '')).toBe(false);
  });

  it('checkout creates Odoo sale order (not BT-M1 mock)', async () => {
    const email = process.env.SMOKE_EMAIL || 'new.user@example.com';
    const password = process.env.SMOKE_PASSWORD || 'Password1!';

    let login = await request(API_BASE)
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    if (!login.body?.data?.accessToken) {
      login = await request(API_BASE)
        .post('/v1/auth/register')
        .send({
          email,
          password,
          confirmPassword: password,
          acceptTerms: true,
        });
    }
    const token = login.body.data.accessToken as string;

    const prodRes = await request(API_BASE).get('/v1/catalog/products/tiger-x-5w30-sn');
    const product = data<{
      packagingOptions: Array<{ id: string; default?: boolean }>;
    }>(prodRes.body);
    const pkg =
      product.packagingOptions.find((p) => p.default) ?? product.packagingOptions[0];

    const cartRes = await request(API_BASE).post('/v1/cart').send({});
    const cartId = data<{ id: string }>(cartRes.body).id;

    await request(API_BASE)
      .post(`/v1/cart/${cartId}/items`)
      .send({
        productSlug: 'tiger-x-5w30-sn',
        packagingOptionId: pkg.id,
        quantity: 1,
        palletType: 'unit',
      })
      .expect(201);

    await request(API_BASE)
      .put(`/v1/checkout/${cartId}/address`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shippingAddress: {
          countryCode: 'SA',
          addressLine1: '3462 Old Al-Kharj Road',
          city: 'Riyadh',
          postalCode: '11564',
          usageTypes: ['shipping'],
        },
        billingSameAsShipping: true,
        deliveryContact: {
          usageTypes: ['delivery'],
          firstName: 'Live',
          lastName: 'Test',
          email,
          phone: '+966500000001',
        },
      });

    const shipOptsRaw = data<{
      options?: Array<{ id: string }>;
      recommendation?: { message?: string };
    } & Array<{ id: string }>>(
      (await request(API_BASE)
        .get(`/v1/checkout/${cartId}/shipping-options`)
        .set('Authorization', `Bearer ${token}`)).body,
    );
    const shipOpts = Array.isArray(shipOptsRaw)
      ? shipOptsRaw
      : shipOptsRaw.options ?? [];
    expect(shipOpts.length).toBeGreaterThan(0);

    await request(API_BASE)
      .put(`/v1/checkout/${cartId}/shipping`)
      .set('Authorization', `Bearer ${token}`)
      .send({ shippingOptionId: shipOpts[0].id });

    const submit = await request(API_BASE)
      .post(`/v1/checkout/${cartId}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true });
    const order = data<{ orderNumber: string }>(submit.body);
    expect(orderNumberLooksLikeMock(order.orderNumber)).toBe(false);
    expect(order.orderNumber).toMatch(/^S\d+/);
  });
});
