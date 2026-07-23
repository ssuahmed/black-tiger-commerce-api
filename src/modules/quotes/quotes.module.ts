import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
