import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ErrorsModule } from '../errors/errors.module';
import { ObservabilityModule } from '../observability/observability.module';
import { InternalEndpointGuard } from './internal-endpoint.guard';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, ErrorsModule, ObservabilityModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, InternalEndpointGuard],
  exports: [UsersService, InternalEndpointGuard],
})
export class UsersModule {}
