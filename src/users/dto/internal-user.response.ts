import { InternalUser } from '../users.types';

export type InternalUserResponse = {
  id: string;
  ecosystemCode: string;
  userId: string;
  region: string | null;
};

export type InternalUserEnvelope = {
  data: InternalUserResponse;
  requestId: string | null;
};

export function toInternalUserResponse(user: InternalUser): InternalUserResponse {
  return {
    id: user.id,
    ecosystemCode: user.ecosystemCode,
    userId: user.userId,
    region: user.region,
  };
}
