import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { DatabaseModule } from './database/database.module';
import { ErrorsModule } from './errors/errors.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { ObservabilityModule } from './observability/observability.module';
import { PreferencesModule } from './preferences/preferences.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, databaseConfig],
    }),
    ObservabilityModule,
    ErrorsModule,
    DatabaseModule,
    UsersModule,
    PreferencesModule,
    EvaluationModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
