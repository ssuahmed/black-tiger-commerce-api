import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PersistenceService } from '../src/persistence/persistence.service';
import { createE2eApp, data } from './bootstrap-e2e';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-min-32-chars-long';
process.env.NODE_ENV ??= 'test';
process.env.PAYTABS_SERVER_KEY = 'e2e-paytabs-server-key';
process.env.PAYTABS_PROFILE_ID = '99999';
process.env.PAYMENT_GATEWAY = 'paytabs';

describe('PayTabs webhook (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.PAYMENT_GATEWAY = 'paytabs';
    process.env.PAYTABS_SERVER_KEY = 'e2e-paytabs-server-key';
    app = await createE2eApp('fixture');
  }, 30_000);

  afterEach(async () => {
    process.env.PAYMENT_GATEWAY = 'sandbox';
    if (app) await app.close();
  }, 30_000);

  it('rejects unsigned PayTabs callback', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/paytabs')
      .send({ tran_ref: 'x', payment_result: { response_status: 'A' } })
      .expect(401);
  });

  it('marks intent succeeded on signed approved callback', async () => {
    const persistence = app.get(PersistenceService);
    persistence.paymentIntentsById.set('pi-e2e', {
      paymentIntentId: 'pi-e2e',
      cartId: 'cart-e2e',
      userId: 'user-e2e',
      method: 'card',
      amount: 200,
      currency: 'SAR',
      status: 'requires_payment_method',
      clientSecret: 'paytabs_e2e',
      redirectUrl: 'https://example.com/hpp',
      tranRef: 'E2E-TRAN',
      gateway: 'paytabs',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    persistence.paymentIntentsByTranRef.set('E2E-TRAN', 'pi-e2e');

    const payload = {
      tran_ref: 'E2E-TRAN',
      payment_result: { response_status: 'A' },
    };
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', process.env.PAYTABS_SERVER_KEY!)
      .update(body)
      .digest('hex');

    const res = await request(app.getHttpServer())
      .post('/internal/webhooks/paytabs')
      .set('Content-Type', 'application/json')
      .set('Signature', signature)
      .send(payload)
      .expect(200);

    const result = data<{ status: string; matched: boolean }>(res.body);
    expect(result.matched).toBe(true);
    expect(result.status).toBe('succeeded');
    expect(persistence.paymentIntentsById.get('pi-e2e')?.status).toBe('succeeded');
  });
});
