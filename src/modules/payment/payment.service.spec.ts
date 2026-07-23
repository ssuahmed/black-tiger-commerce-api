import { NotFoundException } from '@nestjs/common';
import { PersistenceService } from '../../persistence/persistence.service';
import { SandboxPaymentGateway } from './sandbox-payment.gateway';

describe('SandboxPaymentGateway', () => {
  let gateway: SandboxPaymentGateway;
  let persistence: PersistenceService;

  beforeEach(() => {
    persistence = {
      paymentIntentsById: new Map(),
      paymentIntentsByTranRef: new Map(),
      checkoutDrafts: new Map(),
    } as unknown as PersistenceService;
    gateway = new SandboxPaymentGateway(persistence);
  });

  it('creates card intent requiring confirmation', async () => {
    const intent = await gateway.createIntent('cart-1', 'user-1', { method: 'card' });
    expect(intent.gateway).toBe('sandbox');
    expect(intent.status).toBe('requires_confirmation');
    expect(intent.clientSecret).toContain('sandbox_secret_');
  });

  it('creates succeeded intent for COD', async () => {
    const intent = await gateway.createIntent('cart-1', 'user-1', { method: 'cod' });
    expect(intent.status).toBe('succeeded');
  });

  it('confirms card intent', async () => {
    const intent = await gateway.createIntent('cart-1', 'user-1', { method: 'card' });
    const result = await gateway.confirmIntent(intent.paymentIntentId);
    expect(result.status).toBe('succeeded');
    expect(gateway.getIntentStatus(intent.paymentIntentId)).toBe('succeeded');
  });

  it('throws when confirming unknown intent', async () => {
    await expect(gateway.confirmIntent('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
