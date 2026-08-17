/**
 * Auth Nest module: JWT/Passport, Odoo customer auth, mail + WhatsApp OTP,
 * and exports for other domains that need guards or AuthService.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ACCESS_TOKEN_EXPIRY_SEC } from '../../common/constants';
import { MailModule } from '../../infrastructure/mail/mail.module';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { OdooCustomerService } from '../../infrastructure/odoo/odoo-customer.service';
import { WhatsAppModule } from '../../infrastructure/whatsapp/whatsapp.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessStrategy } from './jwt-access.strategy';
import { OptionalJwtGuard } from './optional-jwt.guard';

@Module({
  imports: [
    PersistenceModule,
    MailModule,
    WhatsAppModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: ACCESS_TOKEN_EXPIRY_SEC },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessStrategy,
    OptionalJwtGuard,
    OdooClient,
    OdooCustomerService,
  ],
  exports: [AuthService, JwtModule, OptionalJwtGuard],
})
export class AuthModule {}
