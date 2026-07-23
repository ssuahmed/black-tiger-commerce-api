import { RequestMethod } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { json } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppModule } from '../src/app.module';

type RequestWithRawBody = IncomingMessage & { rawBody?: Buffer };

export async function createE2eApp(
  odooMode: 'fixture' | 'live' = 'fixture',
): Promise<INestApplication> {
  process.env.ODOO_MODE = odooMode;
  delete process.env.REDIS_URL;
  delete process.env.ODOO_URL;
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ bodyParser: false });
  app.use(
    '/internal/webhooks/odoo',
    json({
      verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
        (req as RequestWithRawBody).rawBody = buf;
      },
    }),
  );
  app.use(
    '/internal/webhooks/paytabs',
    json({
      verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
        (req as RequestWithRawBody).rawBody = buf;
      },
    }),
  );
  app.use(json());
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
      { path: 'internal/webhooks/odoo', method: RequestMethod.POST },
      { path: 'internal/webhooks/paytabs', method: RequestMethod.POST },
    ],
  });
  await app.init();
  return app;
}

export function data<T>(body: { data?: T }): T {
  return body.data as T;
}
