import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.constants';
import { Database } from '../database/database.types';
import {
  channels,
  defaultPreferences,
  notificationTypes,
  quietHours,
  userPreferences,
  users,
} from '../drizzle/schema';
import {
  DefaultPreferenceWithUserOverride,
  LocalUser,
  QuietHoursValue,
  ResolvedPreferenceUpdate,
} from './preferences.types';

@Injectable()
export class PreferencesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findUser(ecosystemCode: string, userId: string): Promise<LocalUser | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        ecosystemCode: users.ecosystemCode,
        userId: users.externalUserId,
      })
      .from(users)
      .where(and(eq(users.ecosystemCode, ecosystemCode), eq(users.externalUserId, userId)))
      .limit(1);

    return row ?? null;
  }

  async getDefaultPreferencesWithUserOverrides(userId: string): Promise<DefaultPreferenceWithUserOverride[]> {
    return this.db
      .select({
        notificationType: notificationTypes.code,
        channel: channels.code,
        defaultAllowed: defaultPreferences.allowed,
        userAllowed: userPreferences.allowed,
      })
      .from(defaultPreferences)
      .innerJoin(notificationTypes, eq(defaultPreferences.notificationTypeId, notificationTypes.id))
      .innerJoin(channels, eq(defaultPreferences.channelId, channels.id))
      .leftJoin(
        userPreferences,
        and(
          eq(userPreferences.notificationTypeId, defaultPreferences.notificationTypeId),
          eq(userPreferences.channelId, defaultPreferences.channelId),
          eq(userPreferences.userId, userId),
        ),
      );
  }

  async getQuietHours(userId: string): Promise<QuietHoursValue | null> {
    const [row] = await this.db
      .select({
        startTime: quietHours.startTime,
        endTime: quietHours.endTime,
        timezone: quietHours.timezone,
      })
      .from(quietHours)
      .where(eq(quietHours.userId, userId))
      .limit(1);

    return row ?? null;
  }

  async findNotificationTypeId(code: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: notificationTypes.id })
      .from(notificationTypes)
      .where(eq(notificationTypes.code, code))
      .limit(1);

    return row?.id ?? null;
  }

  async findChannelId(code: string): Promise<string | null> {
    const [row] = await this.db.select({ id: channels.id }).from(channels).where(eq(channels.code, code)).limit(1);

    return row?.id ?? null;
  }

  async updatePreferencesAndQuietHours(
    userId: string,
    preferences: ResolvedPreferenceUpdate[] | undefined,
    quietHoursValue: QuietHoursValue | undefined,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();

      for (const preference of preferences ?? []) {
        await tx
          .insert(userPreferences)
          .values({
            userId,
            notificationTypeId: preference.notificationTypeId,
            channelId: preference.channelId,
            allowed: preference.allowed,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              userPreferences.userId,
              userPreferences.notificationTypeId,
              userPreferences.channelId,
            ],
            set: {
              allowed: preference.allowed,
              updatedAt: now,
            },
          });
      }

      if (quietHoursValue !== undefined) {
        await tx
          .insert(quietHours)
          .values({
            userId,
            startTime: quietHoursValue.startTime,
            endTime: quietHoursValue.endTime,
            timezone: quietHoursValue.timezone,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [quietHours.userId],
            set: {
              startTime: sql`excluded.start_time`,
              endTime: sql`excluded.end_time`,
              timezone: sql`excluded.timezone`,
              updatedAt: now,
            },
          });
      }
    });
  }
}
