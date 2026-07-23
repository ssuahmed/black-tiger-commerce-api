import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';

@Module({
  imports: [PersistenceModule, AuthModule, CartModule, CatalogModule],
  controllers: [ListsController],
  providers: [ListsService],
})
export class ListsModule {}
