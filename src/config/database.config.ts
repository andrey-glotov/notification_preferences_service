import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
}));
