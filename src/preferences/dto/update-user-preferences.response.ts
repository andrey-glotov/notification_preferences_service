import { UserIdentity } from '../preferences.types';

export type UpdateUserPreferencesResponse = {
  ecosystemCode: string;
  userId: string;
  updated: boolean;
};

export type UpdateUserPreferencesEnvelope = {
  data: UpdateUserPreferencesResponse;
  requestId: string | null;
};

export function toUpdateUserPreferencesResponse(identity: UserIdentity): UpdateUserPreferencesResponse {
  return {
    ecosystemCode: identity.ecosystemCode,
    userId: identity.userId,
    updated: true,
  };
}
