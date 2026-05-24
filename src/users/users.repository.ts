import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.constants';
import { Database } from '../database/database.types';
import { users } from '../drizzle/schema';
import { InternalUser, UpsertInternalUserInput } from './users.types';

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async upsertInternalUser(input: UpsertInternalUserInput): Promise<InternalUser> {
    const now = new Date();
    const regionWasProvided = Object.prototype.hasOwnProperty.call(input, 'region');
    const updateSet = regionWasProvided
      ? {
          region: input.region ?? null,
          updatedAt: now,
        }
      : {
          updatedAt: now,
        };

    const [row] = await this.db
      .insert(users)
      .values({
        ecosystemCode: input.ecosystemCode,
        externalUserId: input.userId,
        region: input.region ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [users.ecosystemCode, users.externalUserId],
        set: updateSet,
      })
      .returning({
        id: users.id,
        ecosystemCode: users.ecosystemCode,
        userId: users.externalUserId,
        region: users.region,
      });

    if (!row) {
      throw new Error('Internal user upsert did not return a row.');
    }

    return row;
  }
}
