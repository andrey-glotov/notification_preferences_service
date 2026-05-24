import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorService } from '../errors/error.service';
import { ObservabilityContextService } from '../observability/observability-context.service';
import { ObservabilityService } from '../observability/observability.service';
import { BasicAuthService } from './basic-auth.service';

export const BASIC_AUTH_REALM = 'Notification Preferences Service';
export const WWW_AUTHENTICATE_VALUE = `Basic realm="${BASIC_AUTH_REALM}"`;

@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(
    private readonly basicAuthService: BasicAuthService,
    private readonly errorService: ErrorService,
    private readonly observabilityContextService: ObservabilityContextService,
    @Optional() private readonly observabilityService?: ObservabilityService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const startedAt = process.hrtime.bigint();
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'OPTIONS') {
      return true;
    }

    if (!this.basicAuthService.isConfigured()) {
      void this.observabilityContextService.getContext();
      this.observabilityService?.recordAuthFailure({ errorCode: 'basic_auth_misconfigured', severity: 'critical' });
      this.recordDuration(startedAt);
      throw this.errorService.internal({
        message: 'Internal server error.',
        details: null,
        component: 'auth',
        operation: 'basic_auth',
        severity: 'critical',
      });
    }
    const credentials = this.basicAuthService.parseAuthorizationHeader(request.headers.authorization);
    if (credentials === null || !this.basicAuthService.verifyCredentials(credentials)) {
      response.setHeader('WWW-Authenticate', WWW_AUTHENTICATE_VALUE);
      void this.observabilityContextService.getContext();
      this.observabilityService?.recordAuthFailure({ errorCode: 'unauthorized', severity: 'warning' });
      this.recordDuration(startedAt);
      throw this.errorService.unauthorized({
        message: 'Authentication is required.',
        details: null,
        component: 'auth',
        operation: 'basic_auth',
        severity: 'warning',
      });
    }

    this.recordDuration(startedAt);
    return true;
  }

  private recordDuration(startedAt: bigint): void {
    this.observabilityService?.recordDuration({
      metricName: 'basic_auth_guard_duration_ms',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      component: 'auth',
      operation: 'basic_auth',
      labels: { operation: 'basic_auth' },
    });
  }
}
