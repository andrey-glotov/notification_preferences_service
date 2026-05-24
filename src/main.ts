import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ErrorService } from './errors/error.service';
import { createValidationPipe } from './errors/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = Number(configService.get<number | string>('APP_PORT') ?? process.env.APP_PORT ?? 3000);
  const errorService = app.get(ErrorService);

  app.useGlobalPipes(createValidationPipe(errorService));

  await app.listen(port);
}

void bootstrap();
