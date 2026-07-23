import { RequestMethod } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-min-32-chars-long';
process.env.NODE_ENV ??= 'test';

describe('Commerce API (e2e)', () => {
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

  it('/health (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.odooMode).toBe('mock');
  });

  it('/ready (GET) reports fixture integration', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);
    expect(res.body.data.status).toBe('ready');
    expect(res.body.data.integration.odooMode).toBe('mock');
    expect(res.body.data.integration.sources.catalog).toBe('mock');
  });

  afterEach(async () => {
    if (app) await app.close();
  });
});
