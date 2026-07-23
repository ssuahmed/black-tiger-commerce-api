import type { JwtPayload } from '../modules/auth/auth.types';

declare global {
  namespace Express {
    /** Passport attaches JWT payload as `req.user`. */
    interface User extends JwtPayload {}

    interface Request {
      requestId: string;
    }
  }
}

export {};
