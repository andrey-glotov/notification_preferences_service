export type InternalUser = {
  id: string;
  ecosystemCode: string;
  userId: string;
  region: string | null;
};

export type UpsertInternalUserInput = {
  ecosystemCode: string;
  userId: string;
  region?: string | null;
};
