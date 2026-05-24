import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ErrorService } from './errors/error.service';
import { DATABASE } from './database/database.constants';
import type { Database } from './database/database.types';

@Injectable()
export class AppService {
  constructor(
      @Inject(DATABASE) private readonly db: Database,
      private readonly errorService: ErrorService,
  ) {}

  getHealth() {
    return {
      status: 'ok',
    };
  }

  async getReady() {
    try {
      await this.db.execute(sql`select 1`);

      return {
        status: 'ready',
        dependencies: {
          postgres: 'ok',
        },
      };
    } catch {
      throw this.errorService.serviceUnavailable({
        message: 'Service unavailable.',
        details: {
          dependency: 'postgres',
        },
        component: 'app',
        operation: 'readiness_check',
      });
    }
  }
}