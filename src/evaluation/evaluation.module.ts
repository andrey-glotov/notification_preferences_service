import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ErrorsModule } from '../errors/errors.module';
import { ObservabilityModule } from '../observability/observability.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [AuthModule, ErrorsModule, ObservabilityModule],
  controllers: [EvaluationController],
  providers: [EvaluationService, EvaluationRepository],
  exports: [EvaluationService],
})
export class EvaluationModule {}
