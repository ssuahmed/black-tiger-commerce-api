/**
 * Required JWT guard: rejects requests without a valid access Bearer token.
 * Uses the Passport `jwt` strategy ({@link JwtAccessStrategy}).
 */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
