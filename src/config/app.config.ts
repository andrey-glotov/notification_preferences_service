import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: Number(process.env.APP_PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
}));
