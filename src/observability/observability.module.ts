import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ObservabilityContextService } from './observability-context.service';
import { ObservabilityMiddleware } from './observability.middleware';
import { OBSERVABILITY_SINK } from './observability.sink';
import { ObservabilityService } from './observability.service';
import { StdoutObservabilitySink } from './stdout-observability.sink';

@Module({
  providers: [
    ObservabilityContextService,
    ObservabilityMiddleware,
    ObservabilityService,
    StdoutObservabilitySink,
    {
      provide: OBSERVABILITY_SINK,
      useExisting: StdoutObservabilitySink,
    },
  ],
  exports: [ObservabilityContextService, ObservabilityService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ObservabilityMiddleware).forRoutes('*');
  }
}
