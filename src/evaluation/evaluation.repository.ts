import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { DATABASE } from '../database/database.constants';
import { Database } from '../database/database.types';
import {
  channels,
  defaultPreferences,
  globalPolicies,
  notificationTypes,
  quietHours,
  userPreferences,
  users,
} from '../drizzle/schema';
import {
  EvaluationChannel,
  EvaluationNotificationType,
  EvaluationQuietHours,
  EvaluationUser,
  MatchingGlobalPolicy,
} from './evaluation.types';

@Injectable()
export class EvaluationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findUser(ecosystemCode: string, userId: string): Promise<EvaluationUser | null> {
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

  async findNotificationType(code: string): Promise<EvaluationNotificationType | null> {
    const [row] = await this.db
      .select({
        id: notificationTypes.id,
        code: notificationTypes.code,
        respectsQuietHours: notificationTypes.respectsQuietHours,
      })
      .from(notificationTypes)
      .where(eq(notificationTypes.code, code))
      .limit(1);

    return row ?? null;
  }

  async findChannel(code: string): Promise<EvaluationChannel | null> {
    const [row] = await this.db
      .select({
        id: channels.id,
        code: channels.code,
      })
      .from(channels)
      .where(eq(channels.code, code))
      .limit(1);

    return row ?? null;
  }

  async findMatchingDenyPolicy(
    notificationTypeId: string,
    channelId: string,
    region: string,
  ): Promise<MatchingGlobalPolicy | null> {
    const [row] = await this.db
      .select({
        id: globalPolicies.id,
        priority: globalPolicies.priority,
      })
      .from(globalPolicies)
      .where(
        and(
          eq(globalPolicies.effect, 'deny'),
          or(eq(globalPolicies.notificationTypeId, notificationTypeId), isNull(globalPolicies.notificationTypeId)),
          or(eq(globalPolicies.channelId, channelId), isNull(globalPolicies.channelId)),
          or(eq(globalPolicies.region, region), isNull(globalPolicies.region)),
        ),
      )
      .orderBy(desc(globalPolicies.priority), asc(globalPolicies.createdAt), asc(globalPolicies.id))
      .limit(1);

    return row ?? null;
  }

  async getQuietHours(userId: string): Promise<EvaluationQuietHours | null> {
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

  async getUserPreferenceAllowed(
    userId: string,
    notificationTypeId: string,
    channelId: string,
  ): Promise<boolean | null> {
    const [row] = await this.db
      .select({
        allowed: userPreferences.allowed,
      })
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, userId),
          eq(userPreferences.notificationTypeId, notificationTypeId),
          eq(userPreferences.channelId, channelId),
        ),
      )
      .limit(1);

    return row?.allowed ?? null;
  }

  async getDefaultPreferenceAllowed(
    notificationTypeId: string,
    channelId: string,
  ): Promise<boolean | null> {
    const [row] = await this.db
      .select({
        allowed: defaultPreferences.allowed,
      })
      .from(defaultPreferences)
      .where(
        and(
          eq(defaultPreferences.notificationTypeId, notificationTypeId),
          eq(defaultPreferences.channelId, channelId),
        ),
      )
      .limit(1);

    return row?.allowed ?? null;
  }
}
