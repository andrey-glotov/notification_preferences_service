import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ObservabilityContextService } from './observability-context.service';
import { ObservabilityMiddleware } from './observability.middleware';

@Module({
  providers: [ObservabilityContextService, ObservabilityMiddleware],
  exports: [ObservabilityContextService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ObservabilityMiddleware).forRoutes('*');
  }
}

