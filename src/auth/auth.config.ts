import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  basicAuthUsername: process.env.BASIC_AUTH_USERNAME,
  basicAuthPassword: process.env.BASIC_AUTH_PASSWORD,
}));
