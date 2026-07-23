import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PersistenceService } from '../../persistence/persistence.service';
import { PayTabsPaymentGateway } from './paytabs-payment.gateway';

describe('PayTabsPaymentGateway', () => {
  let gateway: PayTabsPaymentGateway;
  let persistence: PersistenceService;
  const serverKey = 'paytabs-test-server-key';

  beforeEach(() => {
    persistence = {
      paymentIntentsById: new Map(),
      paymentIntentsByTranRef: new Map(),
      checkoutDrafts: new Map(),
    } as unknown as PersistenceService;

    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          PAYTABS_PROFILE_ID: '12345',
          PAYTABS_SERVER_KEY: serverKey,
          PAYTABS_BASE_URL: 'https://secure.paytabs.sa',
          PAYTABS_CURRENCY: 'SAR',
          PAYTABS_RETURN_URL: 'http://localhost:3000/cart/payment/return',
          PAYTABS_CALLBACK_URL: 'http://localhost:3001/internal/webhooks/paytabs',
        };
        return map[key];
      },
    } as unknown as ConfigService;

    gateway = new PayTabsPaymentGateway(config, persistence);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('createIntent maps PayTabs redirect_url and persists by tran_ref', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          tran_ref: 'TST-REF-1',
          redirect_url: 'https://secure.paytabs.sa/payment/page/abc',
        }),
    });

    const intent = await gateway.createIntent('cart-1', 'user-1', {
      method: 'card',
      amount: 150.5,
      currency: 'SAR',
      customerEmail: 'demo@example.com',
      customerName: 'Demo',
    });

    expect(intent.gateway).toBe('paytabs');
    expect(intent.redirectUrl).toContain('paytabs');
    expect(intent.tranRef).toBe('TST-REF-1');
    expect(intent.status).toBe('requires_payment_method');
    expect(persistence.paymentIntentsByTranRef.get('TST-REF-1')).toBe(
      intent.paymentIntentId,
    );
  });

  it('handleCallback marks succeeded for approved payment', async () => {
    persistence.paymentIntentsById.set('pi-1', {
      paymentIntentId: 'pi-1',
      cartId: 'cart-1',
      userId: 'user-1',
      method: 'card',
      amount: 100,
      currency: 'SAR',
      status: 'requires_payment_method',
      clientSecret: 'paytabs_x',
      redirectUrl: 'https://example.com',
      tranRef: 'TST-OK',
      gateway: 'paytabs',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    persistence.paymentIntentsByTranRef.set('TST-OK', 'pi-1');
    persistence.checkoutDrafts.set('cart-1', {
      cartId: 'cart-1',
      userId: 'user-1',
      payload: { paymentIntent: { paymentIntentId: 'pi-1', status: 'requires_payment_method' } },
    });

    const payload = {
      tran_ref: 'TST-OK',
      payment_result: { response_status: 'A' },
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = createHmac('sha256', serverKey).update(raw).digest('hex');

    const result = gateway.handleCallback(raw, signature);
    expect(result).toMatchObject({
      ok: true,
      matched: true,
      status: 'succeeded',
      paymentIntentId: 'pi-1',
    });
    expect(persistence.paymentIntentsById.get('pi-1')?.status).toBe('succeeded');
    const draft = persistence.checkoutDrafts.get('cart-1');
    expect(
      (draft?.payload['paymentIntent'] as { status?: string })?.status,
    ).toBe('succeeded');
  });

  it('handleCallback marks failed for declined payment', async () => {
    persistence.paymentIntentsById.set('pi-2', {
      paymentIntentId: 'pi-2',
      cartId: 'cart-2',
      userId: 'user-1',
      method: 'card',
      amount: 100,
      currency: 'SAR',
      status: 'requires_payment_method',
      clientSecret: 'paytabs_y',
      redirectUrl: null,
      tranRef: 'TST-DECLINE',
      gateway: 'paytabs',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    persistence.paymentIntentsByTranRef.set('TST-DECLINE', 'pi-2');

    const payload = {
      tran_ref: 'TST-DECLINE',
      payment_result: { response_status: 'D' },
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = createHmac('sha256', serverKey).update(raw).digest('hex');

    const result = gateway.handleCallback(raw, signature);
    expect(result).toMatchObject({ ok: true, status: 'failed' });
    expect(persistence.paymentIntentsById.get('pi-2')?.status).toBe('failed');
  });

  it('handleCallback rejects invalid signature', () => {
    const raw = Buffer.from('{"tran_ref":"x"}', 'utf8');
    expect(() => gateway.handleCallback(raw, 'bad-sig')).toThrow(UnauthorizedException);
  });
});
