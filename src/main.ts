import { NestFactory } from '@nestjs/core';
import { ConfigService, ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const config = configService.getOrThrow<ConfigType<typeof appConfig>>(appConfig.KEY);

  await app.listen(config.port);
}

void bootstrap();
