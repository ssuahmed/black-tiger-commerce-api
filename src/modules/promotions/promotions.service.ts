import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CartEntity } from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';

export interface PromotionEvaluation {
  code: string;
  label: string;
  discount: number;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly persistence: PersistenceService) {}

  apply(cartId: string, code: string, userId?: string): PromotionEvaluation {
    const cart = this.requireAccessibleCart(cartId, userId);
    const normalized = code.trim().toUpperCase();
    if (!['WELCOME10', 'SAVE50'].includes(normalized)) {
      throw new BadRequestException('Invalid promotion code');
    }
    cart.promoCode = normalized;
    cart.updatedAt = new Date().toISOString();
    return this.evaluate(cart)!;
  }

  remove(cartId: string, userId?: string) {
    const cart = this.requireAccessibleCart(cartId, userId);
    cart.promoCode = null;
    cart.updatedAt = new Date().toISOString();
    return { removed: true, promo: null };
  }

  evaluate(cart: CartEntity, subtotal = 0): PromotionEvaluation | null {
    const code = cart.promoCode?.toUpperCase();
    if (!code) return null;
    if (code === 'WELCOME10') {
      return {
        code,
        label: 'Welcome 10% discount',
        discount: this.round(subtotal * 0.1),
      };
    }
    if (code === 'SAVE50') {
      if (subtotal < 500) {
        return { code, label: 'Save 50 SAR (minimum 500 SAR)', discount: 0 };
      }
      return { code, label: 'Save 50 SAR', discount: 50 };
    }
    return null;
  }

  private requireAccessibleCart(cartId: string, userId?: string): CartEntity {
    const cart = this.persistence.carts.get(cartId);
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.userId && userId && cart.userId !== userId) {
      throw new ForbiddenException('Cart belongs to another account');
    }
    return cart;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
