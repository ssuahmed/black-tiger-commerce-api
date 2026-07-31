import { BadRequestException } from '@nestjs/common';
import type { CartEntity } from '../../persistence/persistence.service';
import { PromotionsService } from './promotions.service';

describe('PromotionsService', () => {
  const cart: CartEntity = {
    id: 'cart-1',
    items: [],
    updatedAt: new Date().toISOString(),
  };
  const persistence = { carts: new Map([[cart.id, cart]]) };
  const service = new PromotionsService(persistence as never);

  afterEach(() => {
    cart.promoCode = null;
  });

  it('evaluates WELCOME10 deterministically', () => {
    service.apply(cart.id, 'welcome10');
    expect(service.evaluate(cart, 1000)).toEqual({
      code: 'WELCOME10',
      label: 'Welcome 10% discount',
      discount: 100,
    });
  });

  it('enforces SAVE50 minimum subtotal', () => {
    service.apply(cart.id, 'SAVE50');
    expect(service.evaluate(cart, 499)?.discount).toBe(0);
    expect(service.evaluate(cart, 500)?.discount).toBe(50);
  });

  it('rejects unknown codes', () => {
    expect(() => service.apply(cart.id, 'NOPE')).toThrow(BadRequestException);
  });
});
