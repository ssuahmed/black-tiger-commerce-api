/**
 * Quotes Nest module: cart + checkout summary snapshotting and PDF generation.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from '../checkout/checkout.module';

@Module({
  imports: [PersistenceModule, AuthModule, CartModule, CheckoutModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
