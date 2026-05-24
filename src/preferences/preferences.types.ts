export type PreferenceSource = 'default_preference' | 'user_preference';

export type PreferenceItem = {
  notificationType: string;
  channel: string;
  allowed: boolean;
};

export type EffectivePreferenceItem = PreferenceItem & {
  source: PreferenceSource;
};

export type DefaultPreferenceWithUserOverride = {
  notificationType: string;
  channel: string;
  defaultAllowed: boolean;
  userAllowed: boolean | null;
};

export type QuietHoursValue = {
  startTime: string;
  endTime: string;
  timezone: string;
};

export type UserIdentity = {
  ecosystemCode: string;
  userId: string;
};

export type LocalUser = UserIdentity & {
  id: string;
};

export type UserPreferences = UserIdentity & {
  preferences: EffectivePreferenceItem[];
  quietHours: QuietHoursValue | null;
};

export type UpdateUserPreferencesInput = UserIdentity & {
  preferences?: PreferenceItem[];
  quietHours?: QuietHoursValue;
};

export type ResolvedPreferenceUpdate = {
  notificationTypeId: string;
  channelId: string;
  allowed: boolean;
};
