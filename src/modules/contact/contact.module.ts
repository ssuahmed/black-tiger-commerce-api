import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [PersistenceModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
