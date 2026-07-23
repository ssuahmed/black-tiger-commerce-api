import { RequestMethod } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-min-32-chars-long';
process.env.NODE_ENV ??= 'test';

function data<T>(body: { data?: T }): T {
  return body.data as T;
}

async function login(server: App): Promise<string> {
  const res = await request(server)
    .post('/v1/auth/login')
    .send({ identifier: 'demo@blacktiger.com.sa', password: 'Password1!' })
    .expect(201);
  const payload = data<{ accessToken: string }>(res.body);
  return payload.accessToken;
}

describe('Cart & checkout (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.ODOO_MODE = 'fixture';
    delete process.env.REDIS_URL;
    delete process.env.ODOO_URL;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1', {
      exclude: [
        { path: 'health', method: RequestMethod.GET },
        { path: 'ready', method: RequestMethod.GET },
      ],
    });
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('completes cart → address → shipping → submit and lists order', async () => {
    const server = app.getHttpServer();

    const cartRes = await request(server).post('/v1/cart').send({}).expect(201);
    const cart = data<{ id: string }>(cartRes.body);
    expect(cart.id).toBeTruthy();

    await request(server)
      .post(`/v1/cart/${cart.id}/items`)
      .send({
        productSlug: 'tiger-10w30-sl-fully-synthetic',
        packagingOptionId: 'pkg-box-1l-x12',
        quantity: 2,
        palletType: 'unit',
      })
      .expect(201);

    const cartGetRes = await request(server)
      .get(`/v1/cart/${cart.id}`)
      .expect(200);
    const cartBody = data<{
      items: Array<{
        unitPrice: number;
        totalPrice: number;
        imageUrl?: string;
        productName?: string;
      }>;
      totals: { subtotal: number; itemCount: number };
    }>(cartGetRes.body);
    expect(cartBody.items).toHaveLength(1);
    expect(cartBody.items[0].unitPrice).toBe(88.5);
    expect(cartBody.items[0].totalPrice).toBe(177);
    expect(cartBody.items[0].productName).toContain('TIGER 10W30');
    expect(cartBody.items[0].imageUrl).toBeTruthy();
    expect(cartBody.totals.subtotal).toBe(177);
    expect(cartBody.totals.itemCount).toBe(2);

    const token = await login(server);

    await request(server)
      .put(`/v1/checkout/${cart.id}/address`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shippingAddress: {
          countryCode: 'SA',
          addressLine1: '3462 Old Al-Kharj Road',
          city: 'Riyadh',
          postalCode: '11564',
          usageTypes: ['shipping'],
          label: 'Home',
        },
        billingSameAsShipping: true,
        deliveryContact: {
          usageTypes: ['delivery', 'order_notifications'],
          firstName: 'Demo',
          lastName: 'Customer',
          email: 'demo@blacktiger.com.sa',
          phone: '+966500000000',
        },
      })
      .expect(200);

    const shipOptsRes = await request(server)
      .get(`/v1/checkout/${cart.id}/shipping-options`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const shipPayload = data<{
      options: Array<{ id: string }>;
      recommendation: { efficiency: { score: number }; message: string };
    }>(shipOptsRes.body);
    expect(shipPayload.options.length).toBeGreaterThan(0);
    expect(shipPayload.recommendation.message).toBeTruthy();

    await request(server)
      .put(`/v1/checkout/${cart.id}/shipping`)
      .set('Authorization', `Bearer ${token}`)
      .send({ shippingOptionId: shipPayload.options[0].id })
      .expect(200);

    const summaryRes = await request(server)
      .get(`/v1/checkout/${cart.id}/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const summary = data<{
      shippingComplete: boolean;
      totals: { grandTotal: number; subtotal: number; shipping: number };
    }>(summaryRes.body);
    expect(summary.shippingComplete).toBe(true);
    expect(summary.totals.grandTotal).toBeGreaterThan(summary.totals.subtotal);

    const submitRes = await request(server)
      .post(`/v1/checkout/${cart.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true })
      .expect(201);
    const order = data<{ orderNumber: string; orderId: string }>(submitRes.body);
    expect(order.orderNumber).toMatch(/^BT-M1-/);
    expect(order.orderId).toBeTruthy();

    const ordersRes = await request(server)
      .get('/v1/account/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ordersPage = data<{ items: Array<{ orderNumber: string }> }>(ordersRes.body);
    expect(ordersPage.items.length).toBe(1);
    expect(ordersPage.items[0].orderNumber).toBe(order.orderNumber);

    await request(server).get(`/v1/cart/${cart.id}`).expect(404);
  });

  it('rejects checkout submit when cart is empty', async () => {
    const server = app.getHttpServer();
    const token = await login(server);

    const cartRes = await request(server).post('/v1/cart').send({}).expect(201);
    const cart = data<{ id: string }>(cartRes.body);

    await request(server)
      .put(`/v1/checkout/${cart.id}/address`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shippingAddress: {
          countryCode: 'SA',
          addressLine1: '1 Test St',
          city: 'Riyadh',
          usageTypes: ['shipping'],
        },
        billingSameAsShipping: true,
        deliveryContact: {
          usageTypes: ['delivery'],
          firstName: 'Demo',
          lastName: 'Customer',
          email: 'demo@blacktiger.com.sa',
          phone: '+966500000000',
        },
      })
      .expect(200);

    await request(server)
      .put(`/v1/checkout/${cart.id}/shipping`)
      .set('Authorization', `Bearer ${token}`)
      .send({ shippingOptionId: 'pallet-standard' })
      .expect(200);

    const submitRes = await request(server)
      .post(`/v1/checkout/${cart.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true })
      .expect(400);
    expect(submitRes.body.success).toBe(false);
  });

  it('rejects checkout submit without address', async () => {
    const server = app.getHttpServer();
    const token = await login(server);

    const cartRes = await request(server).post('/v1/cart').send({}).expect(201);
    const cart = data<{ id: string }>(cartRes.body);

    await request(server)
      .post(`/v1/cart/${cart.id}/items`)
      .send({
        productSlug: 'tiger-10w30-sl-fully-synthetic',
        packagingOptionId: 'pkg-box-1l-x12',
        quantity: 1,
        palletType: 'unit',
      })
      .expect(201);

    const submitRes = await request(server)
      .post(`/v1/checkout/${cart.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirm: true })
      .expect(400);
    expect(submitRes.body.success).toBe(false);
  });
});
