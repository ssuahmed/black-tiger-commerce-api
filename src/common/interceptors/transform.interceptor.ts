import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import { newId } from '../utils/uuid';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      requestId?: string;
    }>();
    const res = context.switchToHttp().getResponse<Response>();

    const meta = {
      requestId: req.requestId?.trim() ? req.requestId : newId(),
      timestamp: new Date().toISOString(),
    };

    return next.handle().pipe(
      map((data: unknown) => {
        if (res.statusCode === 204) {
          return data;
        }
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) {
          return data;
        }
        if (
          typeof data === 'object' &&
          data !== null &&
          'success' in data &&
          (data as { success: unknown }).success === false
        ) {
          return data;
        }
        return { success: true, data, meta };
      }),
    );
  }
}
