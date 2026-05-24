import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ObservabilityModule } from '../observability/observability.module';
import { ErrorService } from './error.service';
import { GlobalExceptionFilter } from './global-exception.filter';

@Module({
  imports: [ObservabilityModule],
  providers: [
    ErrorService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [ErrorService],
})
export class ErrorsModule {}
