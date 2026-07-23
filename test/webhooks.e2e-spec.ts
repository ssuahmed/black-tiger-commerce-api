import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp, data } from './bootstrap-e2e';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-min-32-chars-long';
process.env.NODE_ENV ??= 'test';
process.env.ODOO_WEBHOOK_SECRET = 'e2e-webhook-secret';

describe('Webhooks (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createE2eApp('fixture');
  }, 30_000);

  afterEach(async () => {
    if (app) await app.close();
  }, 30_000);

  it('rejects webhook without signature', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/odoo')
      .send({ model: 'product.template', action: 'write' })
      .expect(401);
  });

  it('accepts signed catalog invalidation webhook', async () => {
    const payload = { model: 'product.template', action: 'write', ids: [1] };
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', process.env.ODOO_WEBHOOK_SECRET!)
      .update(body)
      .digest('hex');
    const res = await request(app.getHttpServer())
      .post('/internal/webhooks/odoo')
      .set('Content-Type', 'application/json')
      .set('X-Odoo-Signature', signature)
      .send(payload)
      .expect(201);
    const result = data<{ invalidated: string[] }>(res.body);
    expect(result.invalidated).toContain('catalog');
  });
});
