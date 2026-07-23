import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp, data } from './bootstrap-e2e';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-min-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-min-32-chars-long';
process.env.NODE_ENV ??= 'test';

describe('Catalog & content (e2e, fixture mode)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createE2eApp('fixture');
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns mock catalog with dataSource=mock', async () => {
    const res = await request(app.getHttpServer()).get('/v1/catalog/categories').expect(200);
    const payload = data<{ categories: unknown[]; dataSource: string }>(res.body);
    expect(payload.dataSource).toBe('mock');
    expect(payload.categories.length).toBeGreaterThan(0);
  });

  it('returns mock product detail with fixture packaging ids', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/catalog/products/tiger-10w30-sl-fully-synthetic')
      .expect(200);
    const product = data<{
      dataSource: string;
      packagingOptions: Array<{ id: string }>;
    }>(res.body);
    expect(product.dataSource).toBe('mock');
    expect(product.packagingOptions[0].id).toMatch(/^pkg-box-/);
  });

  it('returns CMS pages from fixtures', async () => {
    const res = await request(app.getHttpServer()).get('/v1/content/pages').expect(200);
    const pages = data<Array<{ slug: string }>>(res.body);
    expect(pages.some((p) => p.slug === 'home')).toBe(true);
  });

  it('ready probe reports mock sources in fixture mode', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);
    const ready = data<{
      status: string;
      integration: { odooMode: string; sources: { catalog: string } };
    }>(res.body);
    expect(ready.integration.odooMode).toBe('mock');
    expect(ready.integration.sources.catalog).toBe('mock');
    expect(ready.status).toBe('ready');
  });
});
