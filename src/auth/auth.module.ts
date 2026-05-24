import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ErrorsModule } from '../errors/errors.module';
import { ObservabilityModule } from '../observability/observability.module';
import { authConfig } from './auth.config';
import { BasicAuthGuard } from './basic-auth.guard';
import { BasicAuthService } from './basic-auth.service';

@Module({
  imports: [ConfigModule.forFeature(authConfig), ErrorsModule, ObservabilityModule],
  providers: [
    BasicAuthService,
    {
      provide: APP_GUARD,
      useClass: BasicAuthGuard,
    },
  ],
  exports: [BasicAuthService],
})
export class AuthModule {}
