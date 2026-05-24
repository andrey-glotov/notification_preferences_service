import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'async_hooks';
import { ObservabilityContext } from './observability-context.types';

export const DEFAULT_SERVICE_ID = 'notification-preferences-service';

@Injectable()
export class ObservabilityContextService {
  private readonly storage = new AsyncLocalStorage<ObservabilityContext>();
  private readonly serviceId: string;

  constructor(private readonly configService: ConfigService) {
    this.serviceId = this.resolveServiceId();
  }

  runWithContext<T>(context: ObservabilityContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getRequestId(): string | null {
    return this.getContext()?.requestId ?? null;
  }

  getServiceId(): string {
    return this.getContext()?.serviceId ?? this.serviceId;
  }

  getCorrelationId(): string | null {
    return this.getContext()?.correlationId ?? null;
  }

  getContext(): ObservabilityContext | null {
    return this.storage.getStore() ?? null;
  }

  private resolveServiceId(): string {
    const configuredServiceId =
      this.configService.get<string>('app.serviceId') ?? this.configService.get<string>('SERVICE_ID');

    return configuredServiceId?.trim() || DEFAULT_SERVICE_ID;
  }
}

