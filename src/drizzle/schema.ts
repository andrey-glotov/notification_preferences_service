import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Drizzle's inferred table types trip TS2883 while declaration output is enabled.
// Keep the runtime schema explicit and avoid leaking Drizzle internal CJS paths into d.ts.
export const users: any = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ecosystemCode: varchar('ecosystem_code', { length: 64 }).notNull(),
    externalUserId: varchar('external_user_id', { length: 128 }).notNull(),
    region: varchar('region', { length: 32 }),
    ...timestamps(),
  },
  (table) => [
    unique('users_external_identity_uniq').on(table.ecosystemCode, table.externalUserId),
    index('users_external_identity_idx').on(table.ecosystemCode, table.externalUserId),
    index('users_region_idx').on(table.region),
  ],
);

export const notificationTypes: any = pgTable(
  'notification_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    respectsQuietHours: boolean('respects_quiet_hours').notNull(),
    ...timestamps(),
  },
  (table) => [unique('notification_types_code_uniq').on(table.code)],
);

export const channels: any = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    ...timestamps(),
  },
  (table) => [unique('channels_code_uniq').on(table.code)],
);

export const defaultPreferences: any = pgTable(
  'default_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationTypeId: uuid('notification_type_id')
      .notNull()
      .references(() => notificationTypes.id),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id),
    allowed: boolean('allowed').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('default_preferences_type_channel_uniq').on(
      table.notificationTypeId,
      table.channelId,
    ),
  ],
);

export const userPreferences: any = pgTable(
  'user_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    notificationTypeId: uuid('notification_type_id')
      .notNull()
      .references(() => notificationTypes.id),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id),
    allowed: boolean('allowed').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('user_preferences_user_type_channel_uniq').on(
      table.userId,
      table.notificationTypeId,
      table.channelId,
    ),
    index('user_preferences_user_id_idx').on(table.userId),
    index('user_preferences_lookup_idx').on(
      table.userId,
      table.notificationTypeId,
      table.channelId,
    ),
  ],
);

export const quietHours: any = pgTable(
  'quiet_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('quiet_hours_user_id_uniq').on(table.userId),
    check('quiet_hours_start_end_not_equal_chk', sql`${table.startTime} <> ${table.endTime}`),
    index('quiet_hours_user_id_idx').on(table.userId),
  ],
);

export const globalPolicies: any = pgTable(
  'global_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationTypeId: uuid('notification_type_id').references(() => notificationTypes.id),
    channelId: uuid('channel_id').references(() => channels.id),
    region: varchar('region', { length: 32 }),
    effect: varchar('effect', { length: 16 }).notNull(),
    reason: text('reason').notNull(),
    priority: integer('priority').notNull(),
    ...timestamps(),
  },
  (table) => [
    check('global_policies_effect_chk', sql`${table.effect} in ('allow', 'deny')`),
    check('global_policies_priority_non_negative_chk', sql`${table.priority} >= 0`),
    check(
      'global_policies_at_least_one_selector_chk',
      sql`${table.notificationTypeId} is not null or ${table.channelId} is not null or ${table.region} is not null`,
    ),
    index('global_policies_lookup_idx').on(
      table.notificationTypeId,
      table.channelId,
      table.region,
    ),
    index('global_policies_priority_idx').on(table.priority.desc()),
  ],
);
