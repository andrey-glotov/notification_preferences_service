import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ErrorsModule } from '../errors/errors.module';
import { ObservabilityModule } from '../observability/observability.module';
import { authConfig } from './auth.config';
import { BasicAuthGuard } from './basic-auth.guard';
import { BasicAuthService } from './basic-auth.service';

@Module({
  imports: [ConfigModule.forFeature(authConfig), ErrorsModule, ObservabilityModule],
  providers: [BasicAuthService, BasicAuthGuard],
  exports: [BasicAuthService, BasicAuthGuard],
})
export class AuthModule {}
