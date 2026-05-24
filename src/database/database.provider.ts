import { Provider } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { databaseConfig } from '../config/database.config';
import * as schema from '../drizzle/schema';
import { DATABASE } from './database.constants';

export const databaseProvider: Provider = {
  provide: DATABASE,
  inject: [databaseConfig.KEY],
  useFactory: (config: ConfigType<typeof databaseConfig>) => {
    const pool = new Pool({
      connectionString: config.url,
    });

    return drizzle(pool, { schema });
  },
};
