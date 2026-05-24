export type EvaluationDecision = 'allow' | 'deny';

export type EvaluationReason =
  | 'blocked_by_global_policy'
  | 'blocked_by_quiet_hours'
  | 'allowed_by_user_preference'
  | 'blocked_by_user_preference'
  | 'allowed_by_default_preference'
  | 'blocked_by_default_preference'
  | 'fallback_deny';

export type EvaluationSource =
  | 'global_policy'
  | 'quiet_hours'
  | 'user_preference'
  | 'default_preference'
  | 'fallback';

export type EvaluationResult = {
  decision: EvaluationDecision;
  reason: EvaluationReason;
  source: EvaluationSource;
};

export type EvaluationInput = {
  ecosystemCode: string;
  userId: string;
  notificationType: string;
  channel: string;
  region: string;
  datetime: string;
};

export type EvaluationUser = {
  id: string;
  ecosystemCode: string;
  userId: string;
};

export type EvaluationNotificationType = {
  id: string;
  code: string;
  respectsQuietHours: boolean;
};

export type EvaluationChannel = {
  id: string;
  code: string;
};

export type EvaluationQuietHours = {
  startTime: string;
  endTime: string;
  timezone: string;
};

export type MatchingGlobalPolicy = {
  id: string;
  priority: number;
};
