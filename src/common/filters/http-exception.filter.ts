import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorEnvelopeBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; message: string; code?: string }>;
  };
  meta: { requestId: string; timestamp: string };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const meta = {
      requestId: request.requestId ?? '',
      timestamp: new Date().toISOString(),
    };

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Unexpected error';
    let details:
      | Array<{ field?: string; message: string; code?: string }>
      | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = this.codeFromStatus(status);
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message =
          typeof b.message === 'string'
            ? b.message
            : Array.isArray(b.message)
              ? (b.message as string[]).join('; ')
              : message;
        code = typeof b.error === 'string' ? String(b.error) : this.codeFromStatus(status);
        if (Array.isArray(b.message)) {
          details = (b.message as string[]).map((m) => ({
            message: m,
            code: 'VALIDATION_ERROR',
          }));
        }
        if (Array.isArray((b as { details?: unknown }).details)) {
          details = (b as { details: typeof details }).details;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = 'Internal server error';
    }

    const payload: ErrorEnvelopeBody = {
      success: false,
      error: { code, message, details },
      meta,
    };

    response.status(status).json(payload);
  }

  private codeFromStatus(status: number): string {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 422) return 'UNPROCESSABLE_ENTITY';
    if (status === 429) return 'TOO_MANY_REQUESTS';
    return 'HTTP_ERROR';
  }
}
