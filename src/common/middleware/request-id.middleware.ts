import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newId } from '../utils/uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers['x-request-id'];
    const headerId =
      typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
    const id = headerId && headerId.trim().length > 0 ? headerId : newId();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
