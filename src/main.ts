import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppModule } from './app.module';

type RequestWithRawBody = IncomingMessage & { rawBody?: Buffer };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

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

  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
      { path: 'internal/webhooks/odoo', method: RequestMethod.POST },
      { path: 'internal/webhooks/paytabs', method: RequestMethod.POST },
      { path: 'docs', method: RequestMethod.ALL },
      { path: 'docs-json', method: RequestMethod.GET },
    ],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Black Tiger Commerce API')
    .setDescription('Black Tiger Commerce API — storefront, cart, checkout, account, and CMS integration')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
