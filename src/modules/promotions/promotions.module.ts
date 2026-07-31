import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [PersistenceModule],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
