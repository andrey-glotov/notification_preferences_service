import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ObservabilityContextService } from './observability-context.service';
import { generateRequestId, isValidRequestId } from './request-id';

@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  constructor(private readonly contextService: ObservabilityContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.resolveRequestId(req.headers['x-request-id']);
    const correlationId = this.resolveCorrelationId(req.headers['x-correlation-id']);
    const startedAt = process.hrtime.bigint();

    res.setHeader('X-Request-Id', requestId);
    res.once('finish', () => {
      this.measureDuration(startedAt);
    });

    this.contextService.runWithContext(
      {
        requestId,
        serviceId: this.contextService.getServiceId(),
        correlationId,
      },
      next,
    );
  }

  private resolveRequestId(headerValue: unknown): string {
    return isValidRequestId(headerValue) ? headerValue : generateRequestId();
  }

  private resolveCorrelationId(headerValue: unknown): string | null {
    return isValidRequestId(headerValue) ? headerValue : null;
  }

  private measureDuration(startedAt: bigint): void {
    try {
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    } catch {
      // HTTP telemetry must never affect request handling.
    }
  }
}
