import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { WebhookSignatureGuard } from './webhook-signature.guard';

describe('WebhookSignatureGuard', () => {
  const secret = 'test-webhook-secret';
  const config = {
    get: (key: string) =>
      key === 'ODOO_WEBHOOK_SECRET' ? secret : undefined,
  } as ConfigService;

  function context(body: string, signature?: string) {
    const rawBody = Buffer.from(body);
    const req = {
      header: (name: string) =>
        name.toLowerCase() === 'x-odoo-signature' ? signature : undefined,
      rawBody,
      body: JSON.parse(body),
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
  }

  it('accepts valid HMAC signature', () => {
    const body = JSON.stringify({ model: 'product.template' });
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    const guard = new WebhookSignatureGuard(config);
    expect(guard.canActivate(context(body, sig))).toBe(true);
  });

  it('rejects missing signature', () => {
    const body = JSON.stringify({ model: 'product.template' });
    const guard = new WebhookSignatureGuard(config);
    expect(() => guard.canActivate(context(body))).toThrow(UnauthorizedException);
  });

  it('rejects invalid signature', () => {
    const body = JSON.stringify({ model: 'product.template' });
    const guard = new WebhookSignatureGuard(config);
    expect(() => guard.canActivate(context(body, 'deadbeef'))).toThrow(
      UnauthorizedException,
    );
  });
});
