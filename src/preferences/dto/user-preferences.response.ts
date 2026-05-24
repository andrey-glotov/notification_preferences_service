import { UserPreferences } from '../preferences.types';

export type EffectivePreferenceResponseItem = {
  notificationType: string;
  channel: string;
  allowed: boolean;
  source: 'default_preference' | 'user_preference';
};

export type QuietHoursResponse = {
  startTime: string;
  endTime: string;
  timezone: string;
};

export type UserPreferencesResponse = {
  ecosystemCode: string;
  userId: string;
  preferences: EffectivePreferenceResponseItem[];
  quietHours: QuietHoursResponse | null;
};

export type UserPreferencesEnvelope = {
  data: UserPreferencesResponse;
  requestId: string | null;
};

export function toUserPreferencesResponse(preferences: UserPreferences): UserPreferencesResponse {
  return {
    ecosystemCode: preferences.ecosystemCode,
    userId: preferences.userId,
    preferences: preferences.preferences,
    quietHours: preferences.quietHours,
  };
}
