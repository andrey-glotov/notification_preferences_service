# Agent 01: PostgreSQL Schema

## Goal

Implement the PostgreSQL schema for the Notification Preferences Service using Drizzle ORM.

Prepare:

- Drizzle schema;
- database migrations;
- base seed data for dictionaries and default preferences;
- development/test seed data for a sample global policy.

This stage is responsible only for the transactional PostgreSQL data model.

This stage must not implement:

- REST API;
- controllers;
- Basic Auth;
- observability context;
- errors module;
- observability events/metrics;
- domain services.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml).

## Project Context

The project already has base infrastructure:

- [drizzle.config.ts](../../drizzle.config.ts);
- [src/drizzle/schema.ts](../../src/drizzle/schema.ts);
- [src/database/database.module.ts](../../src/database/database.module.ts);
- [package.json](../../package.json).

Use the existing scripts:

```bash
pnpm run drizzle:generate
pnpm run drizzle:migrate
```

If seed scripts do not exist yet, add minimal TypeScript seed scripts and corresponding `package.json` scripts.

## Scope

This agent must implement only the database layer.

Allowed changes:

- Drizzle schema;
- generated migration files;
- seed scripts;
- package scripts needed for seed execution;
- minimal database-related helper files if required by the existing project structure.

Do not change API contracts, controllers, auth, errors, observability context or domain modules in this task.

## 1. Drizzle Schema

Define all MVP PostgreSQL tables in:

```text
src/drizzle/schema.ts
```

Required tables:

- `users`;
- `notification_types`;
- `channels`;
- `default_preferences`;
- `user_preferences`;
- `quiet_hours`;
- `global_policies`.

The schema must match [docs/business-logic.md](../business-logic.md).

### General Requirements

All tables must have:

- `id uuid primary key`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`.

Use PostgreSQL-compatible timestamp types with timezone.

Do not add fields that are not described in the business document unless there is a clear technical reason and it is documented in the final report.

Do not add a generic `enabled` flag to default preferences or global policies.

## 2. `users`

The `users` table stores a local user projection inside Notification Preferences Service.

The service does not own the full user profile.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Local internal user id. |
| `ecosystem_code` | `varchar(64)` | not null | Ecosystem or tenant code. |
| `external_user_id` | `varchar(128)` | not null | User id in the external system. |
| `region` | `varchar(32)` | nullable | Last known user region from user/profile service. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
unique(ecosystem_code, external_user_id)
```

Required indexes:

```text
users_external_identity_idx on users(ecosystem_code, external_user_id)
users_region_idx on users(region)
```

Business rule:

- relations from other tables must use local `users.id`;
- API-facing `userId` maps to `users.external_user_id`;
- external identity is the pair `ecosystem_code + external_user_id` to avoid collisions between ecosystems.

## 3. `notification_types`

The `notification_types` table is a dictionary of notification categories.

Examples:

- `marketing`;
- `transactional`;
- `security`;
- `order_status`.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Internal notification type id. |
| `code` | `varchar(64)` | not null, unique | Stable machine-readable code. |
| `name` | `varchar(128)` | not null | Human-readable name. |
| `description` | `text` | nullable | Optional description. |
| `respects_quiet_hours` | `boolean` | not null | Whether this type is blocked during quiet hours. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
unique(code)
```

Business rule:

- marketing and other non-critical notification types should have `respects_quiet_hours = true`;
- transactional and security notification types may have `respects_quiet_hours = false`.

## 4. `channels`

The `channels` table is a dictionary of delivery channels.

Examples:

- `email`;
- `sms`;
- `push`;
- `messenger`.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Internal channel id. |
| `code` | `varchar(64)` | not null, unique | Stable machine-readable code. |
| `name` | `varchar(128)` | not null | Human-readable name. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
unique(code)
```

## 5. `default_preferences`

The `default_preferences` table stores the singleton default preference set for the whole service.

Default preferences are used when a user does not have an explicit preference for a `notification type + channel` pair.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Internal default preference id. |
| `notification_type_id` | `uuid` | not null, foreign key | References `notification_types.id`. |
| `channel_id` | `uuid` | not null, foreign key | References `channels.id`. |
| `allowed` | `boolean` | not null | Whether notifications are allowed by default. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
unique(notification_type_id, channel_id)
```

Foreign keys:

```text
default_preferences.notification_type_id -> notification_types.id
default_preferences.channel_id -> channels.id
```

Business rule:

- this table represents a singleton default set;
- do not add profile/version fields in the MVP;
- do not add an `enabled` flag;
- there must be at most one default value for each `notification type + channel` pair.

## 6. `user_preferences`

The `user_preferences` table stores individual user preferences for `notification type + channel` pairs.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Internal user preference id. |
| `user_id` | `uuid` | not null, foreign key | References `users.id`. |
| `notification_type_id` | `uuid` | not null, foreign key | References `notification_types.id`. |
| `channel_id` | `uuid` | not null, foreign key | References `channels.id`. |
| `allowed` | `boolean` | not null | Whether the user allowed this notification through this channel. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
unique(user_id, notification_type_id, channel_id)
```

Foreign keys:

```text
user_preferences.user_id -> users.id
user_preferences.notification_type_id -> notification_types.id
user_preferences.channel_id -> channels.id
```

Required indexes:

```text
user_preferences_user_id_idx on user_preferences(user_id)
user_preferences_lookup_idx on user_preferences(user_id, notification_type_id, channel_id)
```

Business rule:

- user preferences must be linked to local `users.id`;
- this unique constraint enables idempotent upsert for preference updates;
- repeated updates with the same payload must not create duplicates.

## 7. `quiet_hours`

The `quiet_hours` table stores one quiet-hours configuration per user.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Internal quiet-hours id. |
| `user_id` | `uuid` | not null, unique, foreign key | References `users.id`. |
| `start_time` | `time` | not null | Local start time. |
| `end_time` | `time` | not null | Local end time. |
| `timezone` | `varchar(64)` | not null | IANA timezone, for example `Asia/Yekaterinburg`. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
unique(user_id)
start_time != end_time
```

Foreign keys:

```text
quiet_hours.user_id -> users.id
```

Required indexes:

```text
quiet_hours_user_id_idx on quiet_hours(user_id)
```

Business rules:

- `start_time < end_time` means an interval inside one day, for example `13:00-15:00`;
- `start_time > end_time` means an interval crossing midnight, for example `22:00-08:00`;
- `start_time = end_time` is invalid and must be rejected;
- timezone must be stored as an IANA timezone string;
- application-level validation must also validate timezone, but the database must still enforce `start_time != end_time`.

## 8. `global_policies`

The `global_policies` table stores global allow/deny policies by notification type, channel and region.

For the MVP, evaluation uses matching global `deny` policies.

Global `allow` policies are allowed by the schema for future compatibility, but they must not change the MVP evaluation algorithm unless business logic and OpenAPI are explicitly updated.

Required columns:

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Internal policy id. |
| `notification_type_id` | `uuid` | nullable, foreign key | References `notification_types.id`. `null` means any notification type. |
| `channel_id` | `uuid` | nullable, foreign key | References `channels.id`. `null` means any channel. |
| `region` | `varchar(32)` | nullable | Region code. `null` means any region. |
| `effect` | `varchar(16)` | not null | Policy effect: `allow` or `deny`. |
| `reason` | `text` | not null | Human-readable/audit reason. |
| `priority` | `integer` | not null | Higher priority policies are evaluated first. |
| `created_at` | `timestamptz` | not null | Record creation timestamp. |
| `updated_at` | `timestamptz` | not null | Last update timestamp. |

Required constraints:

```text
effect in ('allow', 'deny')
priority >= 0
at least one of notification_type_id, channel_id, region is not null
```

Foreign keys:

```text
global_policies.notification_type_id -> notification_types.id
global_policies.channel_id -> channels.id
```

Required indexes:

```text
global_policies_lookup_idx on global_policies(notification_type_id, channel_id, region)
global_policies_priority_idx on global_policies(priority desc)
```

Business rules:

- nullable fields are wildcards;
- `notification_type_id = null` means any notification type;
- `channel_id = null` means any channel;
- `region = null` means any region;
- if multiple deny policies match during evaluation, the highest priority policy wins;
- if priorities are equal, evaluation must use deterministic ordering such as `created_at asc` or `id asc`;
- `global_policies.reason` may be used for audit/logging, but public evaluation reasons must use stable OpenAPI enums.

## 9. Constraints Summary

Add these integrity constraints:

```text
users:
  unique(ecosystem_code, external_user_id)

notification_types:
  unique(code)

channels:
  unique(code)

default_preferences:
  unique(notification_type_id, channel_id)

user_preferences:
  unique(user_id, notification_type_id, channel_id)

quiet_hours:
  unique(user_id)
  check(start_time != end_time)

global_policies:
  check(effect in ('allow', 'deny'))
  check(priority >= 0)
  check(notification_type_id is not null or channel_id is not null or region is not null)
```

All foreign keys must reference the corresponding dictionary tables or `users`.

Use explicit, readable names for constraints and indexes where possible.

## 10. Indexes Summary

Add only indexes explicitly required by the business document:

```text
users_external_identity_idx on users(ecosystem_code, external_user_id)
users_region_idx on users(region)

user_preferences_user_id_idx on user_preferences(user_id)
user_preferences_lookup_idx on user_preferences(user_id, notification_type_id, channel_id)

quiet_hours_user_id_idx on quiet_hours(user_id)

global_policies_lookup_idx on global_policies(notification_type_id, channel_id, region)
global_policies_priority_idx on global_policies(priority desc)
```

Do not add indexes “just in case” if there is no explicit scenario for them in the documents.

## 11. Migrations

Generate a migration through Drizzle Kit.

Expected result:

- a SQL migration appears in the migrations directory;
- migration can be applied to a clean PostgreSQL database;
- migration should not require manual editing unless Drizzle cannot express a constraint correctly.

If manual migration editing is required, mention it in the final agent report and explain why.

Required commands:

```bash
pnpm run drizzle:generate
pnpm run drizzle:migrate
```

If PostgreSQL is not running and migration cannot be applied, clearly state this in the final report and still run all checks that do not require a database.

## 12. Seed Data

Add idempotent seed scripts for required base data and local/test data.

There must be two seed levels:

1. production/base seed;
2. development/test seed.

### 12.1 Production/Base Seed

Production/base seed must contain only data that is safe for production-like environments.

It must not create:

- test users;
- test global policies;
- development-only data.

Required `notification_types`:

| Code | `respects_quiet_hours` |
| --- | --- |
| `marketing` | `true` |
| `transactional` | `false` |
| `security` | `false` |
| `order_status` | `false` |

Required `channels`:

- `email`;
- `sms`;
- `push`;
- `messenger`.

Required default preferences:

| Notification Type | Channel | Allowed |
| --- | --- | --- |
| `transactional` | `email` | `true` |
| `security` | `email` | `true` |
| `order_status` | `push` | `true` |
| `marketing` | `email` | `false` |
| `marketing` | `sms` | `false` |
| `marketing` | `push` | `false` |

Production/base seed command:

```bash
pnpm run db:seed
```

`db:seed` must apply only production/base seed.

### 12.2 Development/Test Seed

Development/test seed may include data for local verification and tests.

It must run base seed first or assume base seed exists.

Required test global policy:

| Notification Type | Channel | Region | Effect | Reason | Priority |
| --- | --- | --- | --- | --- | --- |
| `marketing` | `sms` | `EU` | `deny` | `blocked_by_global_policy` | `100` |

Development/test seed command:

```bash
pnpm run db:seed:test
```

`db:seed:test` may apply production/base seed and then development/test seed.

### 12.3 Seed Idempotency

All seed operations must be idempotent.

Repeated seed execution must not create duplicates.

Use upsert or conflict handling based on stable unique keys, for example:

- `notification_types.code`;
- `channels.code`;
- `default_preferences.notification_type_id + channel_id`;
- appropriate global policy uniqueness strategy if a unique constraint is added for seed stability.

If the schema does not define a natural unique constraint for global policies, make the seed script explicitly avoid inserting duplicate test policies.

## 13. What Not to Do

Do not implement:

- REST API;
- controllers;
- Basic Auth guard;
- observability context middleware;
- errors module;
- observability events/metrics module;
- preferences domain logic;
- evaluation domain logic;
- user API;
- request/response envelopes.

Do not change OpenAPI unless the database schema work reveals a real contract inconsistency that must be reported.

Do not rename domain entities from [docs/business-logic.md](../business-logic.md).

Do not add production dependencies unrelated to schema, migration or seed work.

## 14. Verification

Before reporting completion, run:

```bash
pnpm run build
pnpm run drizzle:generate
pnpm run drizzle:migrate
```

If seed scripts exist or were added, run:

```bash
pnpm run db:seed
pnpm run db:seed:test
```

If PostgreSQL is not available, explicitly state:

- which commands were executed;
- which commands could not be executed;
- why they could not be executed;
- what was verified instead.

At minimum, verify TypeScript build and migration generation if the database is unavailable.

## 15. Completion Criteria

The task is complete when:

- Drizzle schema contains all MVP tables;
- all tables use UUID primary keys;
- all tables have `created_at` and `updated_at`;
- constraints match [docs/business-logic.md](../business-logic.md);
- indexes match [docs/business-logic.md](../business-logic.md);
- `default_preferences` is implemented as a singleton default set without an extra `enabled` flag;
- `users` uses local `id` and external pair `ecosystem_code + external_user_id`;
- `user_preferences` references `users.id`;
- `quiet_hours` references `users.id`;
- `notification_types.respects_quiet_hours` exists and is required;
- `global_policies` supports nullable wildcard fields;
- `global_policies.effect` supports `allow` and `deny`;
- migration is generated;
- migration can be applied to a clean database, or inability to apply it is explicitly reported;
- production/base seed is available and safe for production-like environments;
- development/test seed is separated from production/base seed;
- seed data can be applied repeatedly without duplicates;
- no API/auth/errors/observability/domain behavior is implemented in this task.

## 16. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- tables added or changed;
- constraints added;
- indexes added;
- seed data added;
- commands executed;
- commands that could not be executed, with exact reason;
- whether migration was generated;
- whether migration was applied;
- whether seed scripts were executed;
- any manual migration edits, with reason;
- any deviations from the input documents.
