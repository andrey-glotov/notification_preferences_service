import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ErrorsModule } from '../errors/errors.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PreferencesController } from './preferences.controller';
import { PreferencesRepository } from './preferences.repository';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [AuthModule, ErrorsModule, ObservabilityModule],
  controllers: [PreferencesController],
  providers: [PreferencesService, PreferencesRepository],
  exports: [PreferencesService],
})
export class PreferencesModule {}
