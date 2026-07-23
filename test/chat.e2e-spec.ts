import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp, data } from './bootstrap-e2e';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-min-32-chars-long';
process.env.NODE_ENV ??= 'test';
process.env.CHAT_PROVIDER = 'rules';

describe('Chat recommendations (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.CHAT_PROVIDER = 'rules';
    app = await createE2eApp('fixture');
  }, 30_000);

  afterEach(async () => {
    if (app) await app.close();
  }, 30_000);

  it('creates a session and returns product suggestions for viscosity query', async () => {
    const sessionRes = await request(app.getHttpServer())
      .post('/v1/chat/sessions')
      .send({})
      .expect(201);
    const session = data<{ sessionId: string }>(sessionRes.body);
    expect(session.sessionId).toBeTruthy();

    const msgRes = await request(app.getHttpServer())
      .post('/v1/chat/messages')
      .send({ message: 'I need 10W-30 oil for passenger cars', sessionId: session.sessionId })
      .expect(201);
    const msg = data<{
      reply: string;
      products: Array<{ slug: string }>;
      provider: string;
      sessionId: string;
    }>(msgRes.body);
    expect(msg.provider).toBe('rules');
    expect(msg.reply.length).toBeGreaterThan(0);
    expect(msg.products.length).toBeGreaterThan(0);
  });
});
