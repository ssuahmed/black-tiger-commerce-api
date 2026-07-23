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
  return data<{ accessToken: string }>(res.body).accessToken;
}

describe('Saved lists (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.ODOO_MODE = 'fixture';
    process.env.PAYMENT_GATEWAY = 'sandbox';
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

  it('creates list, adds item, and deletes list', async () => {
    const server = app.getHttpServer();
    const token = await login(server);

    const createRes = await request(server)
      .post('/v1/lists')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Fixture list ${Date.now()}`, listType: 'wishlist' })
      .expect(201);
    const list = data<{ id: string }>(createRes.body);
    expect(list.id).toBeTruthy();

    await request(server)
      .post(`/v1/lists/${list.id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        productSlug: 'tiger-10w30-sl-fully-synthetic',
        packagingOptionId: 'pkg-box-1l-x12',
        quantity: 1,
        palletType: 'unit',
      })
      .expect(201);

    const detailRes = await request(server)
      .get(`/v1/lists/${list.id}?includeItems=true`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const detail = data<{ items: unknown[] }>(detailRes.body);
    expect(detail.items).toHaveLength(1);

    await request(server)
      .delete(`/v1/lists/${list.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});
