/**
 * Account Nest module: Odoo customer/order services for profile, address book,
 * and order history behind JWT-guarded routes.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { OdooOrderService } from '../../infrastructure/odoo/odoo-order.service';
import { OdooCustomerService } from '../../infrastructure/odoo/odoo-customer.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [AccountController],
  providers: [AccountService, OdooClient, OdooOrderService, OdooCustomerService],
})
export class AccountModule {}
