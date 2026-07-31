import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartLogisticsService } from './cart-logistics.service';
import { PromotionsModule } from '../promotions/promotions.module';

@Module({
  imports: [PersistenceModule, AuthModule, CatalogModule, PromotionsModule],
  controllers: [CartController],
  providers: [CartService, CartLogisticsService],
  exports: [CartService, CartLogisticsService],
})
export class CartModule {}
