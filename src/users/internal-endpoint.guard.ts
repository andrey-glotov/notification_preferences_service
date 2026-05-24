import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ErrorService } from '../errors/error.service';
import { ObservabilityContextService } from '../observability/observability-context.service';

@Injectable()
export class InternalEndpointGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly errorService: ErrorService,
    private readonly observabilityContextService: ObservabilityContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.isInternalUsersEndpoint(request)) {
      return true;
    }

    if (this.configService.get<boolean>('app.enableInternalEndpoints') === true) {
      return true;
    }

    void this.observabilityContextService.getContext();
    throw this.errorService.notFound({
      message: 'Resource was not found.',
      details: null,
      component: 'users',
      operation: 'internal_endpoint_availability',
    });
  }

  private isInternalUsersEndpoint(request: Request): boolean {
    const path = request.path ?? request.url.split('?')[0];

    return request.method.toUpperCase() === 'POST' && /^\/internal\/[^/]+\/users\/?$/.test(path);
  }
}
