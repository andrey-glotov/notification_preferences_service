import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ObservabilityContextService } from './observability-context.service';
import { ObservabilityService } from './observability.service';
import { generateRequestId, isValidRequestId } from './request-id';

@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  constructor(
    private readonly contextService: ObservabilityContextService,
    @Optional() private readonly observabilityService?: ObservabilityService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.resolveRequestId(req.headers['x-request-id']);
    const correlationId = this.resolveCorrelationId(req.headers['x-correlation-id']);
    const startedAt = process.hrtime.bigint();

    res.setHeader('X-Request-Id', requestId);
    res.once('finish', () => {
      this.recordHttpTelemetry(req, res, startedAt);
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

  private recordHttpTelemetry(req: Request, res: Response, startedAt: bigint): void {
    try {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const statusCode = res.statusCode;
      const operation = 'handle_http_request';
      const payload = {
        method: req.method,
        route: this.normalizeRoute(req),
        statusCode,
        durationMs,
      };

      this.observabilityService?.recordEvent({
        eventType: statusCode >= 500 ? 'http_request_failed' : 'http_request_completed',
        component: 'http',
        operation,
        severity: statusCode >= 500 ? 'error' : 'info',
        payload,
      });
      this.observabilityService?.incrementCounter({
        metricName: 'http_requests_total',
        component: 'http',
        operation,
        labels: {
          operation,
          statusCode,
        },
      });
      if (statusCode >= 500) {
        this.observabilityService?.incrementCounter({
          metricName: 'http_requests_failed_total',
          component: 'http',
          operation,
          labels: { statusCode },
        });
      }
      this.observabilityService?.recordDuration({
        metricName: 'http_request_duration_ms',
        durationMs,
        component: 'http',
        operation,
        labels: { operation },
      });
    } catch {
      // HTTP telemetry must never affect request handling.
    }
  }

  private normalizeRoute(req: Request): string {
    return req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unknown';
  }
}
