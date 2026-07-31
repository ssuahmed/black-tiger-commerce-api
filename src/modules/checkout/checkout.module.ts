import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { OdooOrderService } from '../../infrastructure/odoo/odoo-order.service';
import { OdooShippingService } from '../../infrastructure/odoo/odoo-shipping.service';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentModule } from '../payment/payment.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { ShippingRecommendationEngine } from './shipping-recommendation.engine';
import { PromotionsModule } from '../promotions/promotions.module';
import { GoogleGeocodingService } from '../../infrastructure/google-maps/google-geocoding.service';

@Module({
  imports: [
    PersistenceModule,
    AuthModule,
    CartModule,
    CatalogModule,
    PaymentModule,
    PromotionsModule,
  ],
  controllers: [CheckoutController],
  providers: [
    CheckoutService,
    OdooClient,
    OdooOrderService,
    OdooShippingService,
    ShippingRecommendationEngine,
    GoogleGeocodingService,
  ],
})
export class CheckoutModule {}
