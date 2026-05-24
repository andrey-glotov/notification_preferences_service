import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorService } from '../errors/error.service';
import { ObservabilityContextService } from '../observability/observability-context.service';
import { BasicAuthService } from './basic-auth.service';

export const BASIC_AUTH_REALM = 'Notification Preferences Service';
export const WWW_AUTHENTICATE_VALUE = `Basic realm="${BASIC_AUTH_REALM}"`;

@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(
    private readonly basicAuthService: BasicAuthService,
    private readonly errorService: ErrorService,
    private readonly observabilityContextService: ObservabilityContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.basicAuthService.isConfigured()) {
      void this.observabilityContextService.getContext();
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
      throw this.errorService.unauthorized({
        message: 'Authentication is required.',
        details: null,
        component: 'auth',
        operation: 'basic_auth',
        severity: 'warning',
      });
    }

    return true;
  }
}
