import { NestFactory } from '@nestjs/core';
import { ConfigService, ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';
import { ErrorService } from './errors/error.service';
import { createValidationPipe } from './errors/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const config = configService.getOrThrow<ConfigType<typeof appConfig>>(appConfig.KEY);
  const errorService = app.get(ErrorService);

  app.useGlobalPipes(createValidationPipe(errorService));

  await app.listen(config.port);
}

void bootstrap();
