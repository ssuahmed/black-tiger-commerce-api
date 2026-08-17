/**
 * HMAC-SHA256 guard for Odoo webhook requests (`X-Odoo-Signature`).
 *
 * Storefront → API ← Odoo: rejects unsigned or mismatched payloads so only a
 * configured Odoo instance can bust Redis/catalog caches. Uses `rawBody` when
 * present (see `main.ts` webhook JSON parsers) for a stable digest input.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** Verify `X-Odoo-Signature` against HMAC of the raw request body. */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const secret =
      this.config.get<string>('ODOO_WEBHOOK_SECRET') ||
      this.config.get<string>('WEBHOOK_SECRET') ||
      '';
    if (!secret.trim()) {
      throw new UnauthorizedException('Webhook secret not configured');
    }
    const signature = req.header('x-odoo-signature') || req.header('X-Odoo-Signature');
    if (!signature) {
      throw new UnauthorizedException('Missing X-Odoo-Signature');
    }
    // Prefer raw bytes captured by the webhook-specific json() middleware.
    const raw =
      req.rawBody ??
      Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = signature.trim().toLowerCase();
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    // Constant-time compare to avoid leaking signature length/timing.
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}