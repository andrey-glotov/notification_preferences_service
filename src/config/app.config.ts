import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: Number(process.env.APP_PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  serviceId: process.env.SERVICE_ID ?? 'notification-preferences-service',
  enableInternalEndpoints: process.env.ENABLE_INTERNAL_ENDPOINTS === 'true',
}));
