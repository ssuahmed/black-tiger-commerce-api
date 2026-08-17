/**
 * Passport JWT access-token strategy (`jwt`).
 *
 * Validates Bearer tokens with JWT_ACCESS_SECRET, then hydrates an ephemeral
 * session user from the payload (and Odoo when live) so account routes work
 * after API restarts.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /** Attach validated payload to `req.user` after session hydrate. */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    await this.auth.ensureSessionUser(payload);
    return payload;
  }
}
