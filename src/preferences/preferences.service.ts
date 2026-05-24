import { Injectable } from '@nestjs/common';
import { ErrorService } from '../errors/error.service';
import { PreferencesRepository } from './preferences.repository';
import {
  DefaultPreferenceWithUserOverride,
  EffectivePreferenceItem,
  LocalUser,
  PreferenceItem,
  QuietHoursValue,
  ResolvedPreferenceUpdate,
  UpdateUserPreferencesInput,
  UserIdentity,
  UserPreferences,
} from './preferences.types';

@Injectable()
export class PreferencesService {
  constructor(
    private readonly preferencesRepository: PreferencesRepository,
    private readonly errorService: ErrorService,
  ) {}

  async getUserPreferences(identity: UserIdentity): Promise<UserPreferences> {
    const user = await this.findUserOrThrow(identity, 'get_user_preferences');
    const [preferenceRows, quietHours] = await Promise.all([
      this.preferencesRepository.getDefaultPreferencesWithUserOverrides(user.id),
      this.preferencesRepository.getQuietHours(user.id),
    ]);

    return {
      ecosystemCode: identity.ecosystemCode,
      userId: identity.userId,
      preferences: this.buildEffectivePreferences(preferenceRows),
      quietHours,
    };
  }

  async updateUserPreferences(input: UpdateUserPreferencesInput): Promise<UserIdentity> {
    const user = await this.findUserOrThrow(input, 'update_user_preferences');
    const preferences = input.preferences
      ? await this.resolvePreferenceUpdates(input.preferences, input)
      : undefined;

    try {
      await this.preferencesRepository.updatePreferencesAndQuietHours(
        user.id,
        preferences,
        input.quietHours,
      );
    } catch (error) {
      throw this.errorService.internal({
        message: 'Internal server error.',
        details: null,
        component: 'preferences',
        operation: 'update_user_preferences',
        severity: 'error',
        retryable: false,
        cause: error,
      });
    }

    return {
      ecosystemCode: input.ecosystemCode,
      userId: input.userId,
    };
  }

  private async findUserOrThrow(identity: UserIdentity, operation: string): Promise<LocalUser> {
    const user = await this.preferencesRepository.findUser(identity.ecosystemCode, identity.userId);

    if (user === null) {
      throw this.errorService.notFound({
        message: 'User was not found.',
        details: {
          ecosystemCode: identity.ecosystemCode,
          userId: identity.userId,
        },
        component: 'preferences',
        operation,
      });
    }

    return user;
  }

  private buildEffectivePreferences(
    rows: DefaultPreferenceWithUserOverride[],
  ): EffectivePreferenceItem[] {
    return rows.map((row) => ({
      notificationType: row.notificationType,
      channel: row.channel,
      allowed: row.userAllowed ?? row.defaultAllowed,
      source: row.userAllowed === null ? 'default_preference' : 'user_preference',
    }));
  }

  private async resolvePreferenceUpdates(
    preferences: PreferenceItem[],
    identity: UserIdentity,
  ): Promise<ResolvedPreferenceUpdate[]> {
    const resolved: ResolvedPreferenceUpdate[] = [];

    for (const preference of preferences) {
      const notificationTypeId = await this.preferencesRepository.findNotificationTypeId(
        preference.notificationType,
      );

      if (notificationTypeId === null) {
        throw this.errorService.notFound({
          message: 'Notification type was not found.',
          details: {
            ecosystemCode: identity.ecosystemCode,
            userId: identity.userId,
            notificationType: preference.notificationType,
          },
          component: 'preferences',
          operation: 'update_user_preferences',
        });
      }

      const channelId = await this.preferencesRepository.findChannelId(preference.channel);

      if (channelId === null) {
        throw this.errorService.notFound({
          message: 'Channel was not found.',
          details: {
            ecosystemCode: identity.ecosystemCode,
            userId: identity.userId,
            channel: preference.channel,
          },
          component: 'preferences',
          operation: 'update_user_preferences',
        });
      }

      resolved.push({
        notificationTypeId,
        channelId,
        allowed: preference.allowed,
      });
    }

    return resolved;
  }
}
