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

describe('Auth (e2e)', () => {
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

  it('returns password policy', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/password/policy')
      .expect(200);
    const policy = data<{ rules: Array<{ code: string }> }>(res.body);
    expect(policy.rules.length).toBeGreaterThan(0);
  });

  it('logs in demo user and refreshes token', async () => {
    const server = app.getHttpServer();

    const loginRes = await request(server)
      .post('/v1/auth/login')
      .send({
        identifier: 'demo@blacktiger.com.sa',
        password: 'Password1!',
      })
      .expect(201);

    const tokens = data<{
      accessToken: string;
      refreshToken: string;
      user: { email: string; id: string };
    }>(loginRes.body);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.user.email).toBe('demo@blacktiger.com.sa');
    expect(tokens.user.id).toBeTruthy();
    // Fixture mode keeps local UUID subjects; live mode uses partner:{id}.
    expect(tokens.user.id.includes('password')).toBe(false);

    const refreshRes = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(201);
    const refreshed = data<{ accessToken: string }>(refreshRes.body);
    expect(refreshed.accessToken).toBeTruthy();

    await request(server)
      .get('/v1/account/orders')
      .set('Authorization', `Bearer ${refreshed.accessToken}`)
      .expect(200);
  });

  it('registers a new user', async () => {
    const email = `test-${Date.now()}@blacktiger.com.sa`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        email,
        password: 'Password1!',
        confirmPassword: 'Password1!',
        acceptTerms: true,
      })
      .expect(201);
    const tokens = data<{ user: { email: string; id: string } }>(res.body);
    expect(tokens.user.email).toBe(email);
    expect(tokens.user.id).toBeTruthy();
  });

  it('routes identifier register vs login in fixture mode', async () => {
    const server = app.getHttpServer();
    const fresh = `fresh-${Date.now()}@blacktiger.com.sa`;
    const registerRoute = await request(server)
      .post('/v1/auth/identifier')
      .send({ identifier: fresh, intent: 'register' })
      .expect(201);
    expect(data<{ nextStep: string }>(registerRoute.body).nextStep).toBe(
      'register_form',
    );

    const loginRoute = await request(server)
      .post('/v1/auth/identifier')
      .send({ identifier: 'demo@blacktiger.com.sa', intent: 'register' })
      .expect(201);
    expect(data<{ nextStep: string }>(loginRoute.body).nextStep).toBe(
      'login_method',
    );
  });
});
