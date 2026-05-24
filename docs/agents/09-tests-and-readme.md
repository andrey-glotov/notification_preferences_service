# Agent 09: Tests and README

## Goal

Finalize the Notification Preferences Service by adding and verifying tests, checking the implementation against the original assignment, and updating the README.

This stage is responsible for:

- end-to-end scenario coverage;
- unit/integration/e2e test completeness;
- API contract verification;
- business rule verification;
- security behavior verification;
- observability behavior verification;
- README and local run instructions;
- known limitations and production improvement notes.

This agent must not introduce new business behavior unless a missing requirement is discovered and explicitly documented.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/01-postgres-schema.md](01-postgres-schema.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/agents/03-errors-module.md](03-errors-module.md);
- [docs/agents/04-basic-auth-guard.md](04-basic-auth-guard.md);
- [docs/agents/05-user-api.md](05-user-api.md);
- [docs/agents/06-preferences-domain.md](06-preferences-domain.md);
- [docs/agents/07-evaluation-domain.md](07-evaluation-domain.md);
- [docs/agents/08-observability.md](08-observability.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/observability.md](../observability.md);
- [docs/security-notes.md](../security-notes.md);
- [docs/openapi.yaml](../openapi.yaml).

## Dependencies from Previous Stages

This stage assumes the following modules exist:

- PostgreSQL schema and migrations;
- base seed and test seed;
- observability context;
- errors module;
- Basic Auth guard;
- User API;
- Preferences API;
- Evaluation API;
- Observability events/metrics.

If some module is missing or incomplete, report it explicitly and test everything that is available.

## Scope

This stage may add or update:

- unit tests;
- integration tests;
- e2e tests;
- test helpers;
- test fixtures;
- test database setup;
- README;
- curl examples;
- known limitations;
- final verification checklist.

This stage must not:

- silently change business rules;
- silently change OpenAPI;
- silently bypass Basic Auth in production code;
- replace proper tests with only manual README checks;
- add production infrastructure outside MVP scope.

If a requirement is not implementable because a previous stage is incomplete, document it precisely.

## Recommended Test Structure

Use the project’s existing test conventions.

Recommended structure if no convention exists:

```text
test/
  e2e/
    app.e2e-spec.ts
    user-api.e2e-spec.ts
    preferences.e2e-spec.ts
    evaluation.e2e-spec.ts
    auth.e2e-spec.ts
    observability.e2e-spec.ts
  helpers/
    test-app.ts
    test-db.ts
    auth.ts
    fixtures.ts
    future-datetime.ts

src/
  **/*.spec.ts
```

Use focused unit tests for pure logic and e2e tests for API contracts.

Do not make every scenario an expensive full e2e test if unit/integration coverage is more appropriate.

## 1. Test Environment Requirements

The tests must have a reliable setup.

Required capabilities:

- start NestJS application in test mode;
- connect to test PostgreSQL database;
- run migrations before e2e tests;
- run base seed before tests;
- optionally run test seed before evaluation/global policy tests;
- reset database state between tests or test suites;
- configure Basic Auth credentials for tests;
- configure `SERVICE_ID`;
- configure `ENABLE_INTERNAL_ENDPOINTS` for internal endpoint tests;
- support future datetime generation.

Recommended test env values:

```text
NODE_ENV=test
SERVICE_ID=notification-preferences-service-test
BASIC_AUTH_USERNAME=<test value>
BASIC_AUTH_PASSWORD=<test value>
ENABLE_INTERNAL_ENDPOINTS=true
```

Do not hardcode real credentials.

Test credentials may be generated inside test setup or loaded from test-only environment configuration.

## 2. Test Data Requirements

Required seed/reference data:

### Notification types

- `marketing`, `respects_quiet_hours = true`;
- `transactional`, `respects_quiet_hours = false`;
- `security`, `respects_quiet_hours = false`;
- `order_status`, `respects_quiet_hours = false`.

### Channels

- `email`;
- `sms`;
- `push`;
- `messenger`.

### Default preferences

- `transactional + email = allowed`;
- `security + email = allowed`;
- `order_status + push = allowed`;
- `marketing + email = denied`;
- `marketing + sms = denied`;
- `marketing + push = denied`.

### Test global policy

- `marketing + sms + EU = deny`;
- `reason = blocked_by_global_policy`;
- `priority = 100`.

Required test users:

- `ecosystemCode = vk`, `userId = user-1`, `region = EU`;
- additional users may be created per test.

Tests must not depend on hidden local database state.

## 3. PostgreSQL Schema and Seed Tests

### 3.1 Migration tests

Test cases:

- migration applies to a clean PostgreSQL database;
- all MVP tables exist:
  - `users`;
  - `notification_types`;
  - `channels`;
  - `default_preferences`;
  - `user_preferences`;
  - `quiet_hours`;
  - `global_policies`;
- all tables have UUID primary key;
- all tables have `created_at`;
- all tables have `updated_at`.

### 3.2 Constraint tests

Test cases:

- duplicate `users(ecosystem_code, external_user_id)` is rejected or handled by upsert;
- duplicate `notification_types.code` is rejected;
- duplicate `channels.code` is rejected;
- duplicate `default_preferences(notification_type_id, channel_id)` is rejected;
- duplicate `user_preferences(user_id, notification_type_id, channel_id)` is rejected or handled by upsert;
- duplicate `quiet_hours.user_id` is rejected or handled by upsert;
- `quiet_hours.start_time = quiet_hours.end_time` is rejected;
- `global_policies.effect` rejects values other than `allow` and `deny`;
- `global_policies.priority < 0` is rejected;
- `global_policies` with all of `notification_type_id`, `channel_id`, `region` equal to `null` is rejected.

### 3.3 Foreign key tests

Test cases:

- `default_preferences.notification_type_id` must reference existing notification type;
- `default_preferences.channel_id` must reference existing channel;
- `user_preferences.user_id` must reference existing user;
- `user_preferences.notification_type_id` must reference existing notification type;
- `user_preferences.channel_id` must reference existing channel;
- `quiet_hours.user_id` must reference existing user;
- `global_policies.notification_type_id` must reference existing notification type when not null;
- `global_policies.channel_id` must reference existing channel when not null.

### 3.4 Seed tests

Test cases:

- `db:seed` inserts required notification types;
- `db:seed` inserts required channels;
- `db:seed` inserts required default preferences;
- `db:seed` does not insert test users;
- `db:seed` does not insert development/test global policies;
- running `db:seed` twice does not create duplicates;
- `db:seed:test` inserts required test global policy;
- running `db:seed:test` twice does not create duplicate global policies.

## 4. Observability Context Tests

Test cases:

- request without `X-Request-Id` receives generated `requestId`;
- generated `requestId` is returned in response header `X-Request-Id`;
- generated `requestId` matches documented format if implementation exposes it;
- request with valid `X-Request-Id` reuses the provided value;
- request with invalid `X-Request-Id` receives a new generated value;
- invalid `X-Request-Id` does not return validation error;
- `requestId` is available in downstream handler/service;
- `serviceId` is read from `SERVICE_ID`;
- if `SERVICE_ID` is missing, default `notification-preferences-service` is used;
- valid `X-Correlation-Id` is stored in context;
- invalid `X-Correlation-Id` is ignored;
- `correlationId` is not returned in API response envelope unless OpenAPI defines it;
- response contains `X-Request-Id` on success;
- response contains `X-Request-Id` on error;
- outside HTTP context:
  - `getRequestId()` returns `null`;
  - `getCorrelationId()` returns `null`;
  - `getServiceId()` returns configured/default value;
  - `getContext()` returns `null`.

## 5. Errors Module Tests

Test cases:

### Error envelope

- `ApplicationError` returns `{ error, requestId }`;
- `requestId` is read from observability context;
- when observability context is absent, `requestId` is `null`;
- error response does not include `serviceId` unless OpenAPI defines it;
- error response does not include `correlationId` unless OpenAPI defines it.

### Error codes and statuses

- `validation` returns HTTP `400` and code `validation_error`;
- `badRequest` returns HTTP `400` and code `bad_request`;
- `unauthorized` returns HTTP `401` and code `unauthorized`;
- `notFound` returns HTTP `404` and code `not_found`;
- `conflict` returns HTTP `409` and code `conflict`;
- `internal` returns HTTP `500` and code `internal_server_error`;
- `serviceUnavailable` returns HTTP `503` and code `service_unavailable`.

### Unexpected exceptions

- unexpected exception returns HTTP `500`;
- unexpected exception returns code `internal_server_error`;
- unexpected exception does not expose raw exception message;
- unexpected exception does not expose stack trace;
- unexpected exception returns safe message `Internal server error.` or equivalent.

### Validation details

- validation details contain safe field paths;
- validation details do not contain full request body;
- validation details do not contain request headers;
- validation details do not contain credentials.

### Sanitization

- `error.details` does not contain `Authorization`;
- `error.details` does not contain cookies;
- `error.details` does not contain Basic Auth username/password;
- `error.details` does not contain decoded credentials;
- `error.details` does not contain connection strings;
- `error.details` does not contain raw SQL errors;
- `error.details` does not contain stack traces;
- global exception filter does not generate new `requestId`.

## 6. Basic Auth Tests

Test cases:

### Header parsing

- request without `Authorization` returns `401`;
- request with non-`Basic` scheme returns `401`;
- request with missing token after `Basic` returns `401`;
- request with invalid Base64 returns `401`;
- request with decoded Base64 without `:` returns `401`;
- request with empty username returns `401`;
- request with empty password returns `401`;
- password containing `:` is parsed correctly;
- auth scheme comparison is case-insensitive.

### Credential verification

- wrong username returns `401`;
- wrong password returns `401`;
- wrong username/password does not reveal which part is wrong;
- correct credentials pass to next handler/controller;
- comparison handles different string lengths safely;
- credentials are compared using constant-time safe logic or equivalent implementation.

### Response contract

- every `401` contains `WWW-Authenticate`;
- `WWW-Authenticate` value is `Basic realm="Notification Preferences Service"`;
- unauthorized response body matches `{ error, requestId }`;
- `requestId` comes from observability context.

### Security

- raw `Authorization` header is not present in `error.details`;
- Base64 token is not present in `error.details`;
- decoded credentials are not present in `error.details`;
- username is not present in `error.details`;
- password is not present in `error.details`;
- missing auth env credentials returns safe `internal_server_error`;
- auth misconfiguration does not expose env names or env values to client.

## 7. Internal User API Tests

Endpoint:

```text
POST /internal/:ecosystemCode/users
```

### Availability guard

Test cases:

- when `ENABLE_INTERNAL_ENDPOINTS=false`, endpoint returns `404`;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, user is not created;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, existing user is not updated;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, response does not reveal that endpoint exists but is disabled;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, Basic Auth challenge does not reveal the endpoint;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, endpoint exists;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, request without Basic Auth returns `401`;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, request with valid Basic Auth reaches controller.

### Successful creation/update

Test cases:

- creates a new user;
- response body matches `{ data, requestId }`;
- `data.id` is a UUID;
- `data.ecosystemCode` matches path param;
- `data.userId` matches request body;
- `data.region` matches request body when provided;
- created row contains `ecosystem_code`;
- created row contains `external_user_id`;
- created row contains local `id`.

### Idempotency

Test cases:

- repeated request with same `ecosystemCode + userId` does not create duplicate;
- repeated request with same payload returns same final state;
- repeated request with different `region` updates region;
- request without `region` does not clear existing region;
- request with `region: null` clears region if this semantic is implemented;
- upsert uses `ecosystem_code + external_user_id`.

### Validation

Test cases:

- missing `userId` returns `400 validation_error`;
- invalid `ecosystemCode` returns `400 validation_error`;
- too long `ecosystemCode` returns `400 validation_error`;
- too long `userId` returns `400 validation_error`;
- too long `region` returns `400 validation_error`;
- extra request body fields return `400 validation_error`;
- raw request body is not returned in error details.

## 8. Preferences API Tests

Endpoints:

```text
GET /api/:ecosystemCode/users/:userId/preferences
POST /api/:ecosystemCode/users/:userId/preferences
```

### GET preferences

Test cases:

- new existing user receives default preferences;
- response body matches `{ data, requestId }`;
- response contains `ecosystemCode`;
- response contains `userId`;
- response contains preferences array;
- response contains `quietHours: null` when quiet hours are not configured;
- default preference item has `source = default_preference`;
- user preference item has `source = user_preference`;
- user preference overrides default preference;
- pairs without default preference are not returned unless OpenAPI requires otherwise;
- unknown user returns `404`.

### POST user preferences

Test cases:

- creates user preference;
- updates existing user preference;
- repeated same preference update does not create duplicate;
- `allowed = true` is stored correctly;
- `allowed = false` is stored correctly;
- result after `POST` is reflected in `GET`;
- unknown user returns `404`;
- unknown notification type returns `404`;
- unknown channel returns `404`;
- notification types are not created on the fly;
- channels are not created on the fly;
- user is not created automatically.

### POST quiet hours

Test cases:

- creates quiet hours;
- updates quiet hours;
- repeated same quiet hours update does not create duplicate;
- stores IANA timezone string;
- stores local `start_time`;
- stores local `end_time`;
- same-day interval, for example `13:00-15:00`, is accepted;
- crossing-midnight interval, for example `22:00-08:00`, is accepted;
- `startTime = endTime` returns `400`;
- non-IANA timezone returns `400`;
- malformed time returns `400`.

### Partial updates

Test cases:

- request with only `preferences` does not change existing quiet hours;
- request with only `quietHours` does not change existing user preferences;
- request with both updates both.

### Atomicity

Test cases:

- if request contains valid preference update and invalid quiet hours, preference update is rolled back;
- if request contains valid quiet hours and invalid preference, quiet hours update is rolled back;
- no partial update remains after failed combined update.

### Validation

Test cases:

- empty body returns `400 validation_error`;
- body without `preferences` and `quietHours` returns `400 validation_error`;
- `preferences: []` returns `400 validation_error`;
- missing `notificationType` returns `400 validation_error`;
- missing `channel` returns `400 validation_error`;
- missing `allowed` returns `400 validation_error`;
- non-boolean `allowed` returns `400 validation_error`;
- missing `quietHours.startTime` returns `400 validation_error`;
- missing `quietHours.endTime` returns `400 validation_error`;
- missing `quietHours.timezone` returns `400 validation_error`;
- extra body fields return `400 validation_error`;
- extra nested fields return `400 validation_error`;
- invalid `ecosystemCode` returns `400 validation_error`;
- invalid `userId` returns `400 validation_error`.

### Auth/envelope

Test cases:

- request without Basic Auth returns `401`;
- request with correct Basic Auth reaches controller;
- success response matches `{ data, requestId }`;
- error response matches `{ error, requestId }`;
- `requestId` comes from observability context.

## 9. Evaluation API Tests

Endpoint:

```text
POST /api/:ecosystemCode/evaluate
```

### Global policies

Test cases:

- matching global deny policy blocks sending;
- global deny policy has priority over user preference;
- global deny policy has priority over default preference;
- higher priority global policy is selected first;
- equal priority global policies produce deterministic result;
- wildcard `notification_type_id = null` matches any notification type;
- wildcard `channel_id = null` matches any channel;
- wildcard `region = null` matches any region;
- global `allow` policies do not affect MVP evaluation behavior;
- public decision reason is stable enum `blocked_by_global_policy`;
- raw `global_policies.reason` is not exposed as arbitrary public reason unless it matches OpenAPI enum.

### Quiet hours

Test cases:

- quiet hours block notification type with `respects_quiet_hours = true`;
- quiet hours do not block notification type with `respects_quiet_hours = false`;
- quiet hours same-day interval works;
- quiet hours crossing midnight works;
- datetime is converted to user's IANA timezone before comparison;
- datetime outside quiet hours is not blocked by quiet hours;
- invalid quiet-hours data in DB is handled as safe internal/config error.

### User preference

Test cases:

- user preference `allowed = true` returns:
  - `decision = allow`;
  - `reason = allowed_by_user_preference`;
  - `source = user_preference`;
- user preference `allowed = false` returns:
  - `decision = deny`;
  - `reason = blocked_by_user_preference`;
  - `source = user_preference`;
- user preference overrides default preference.

### Default preference

Test cases:

- default preference is used when user preference is absent;
- default preference `allowed = true` returns:
  - `decision = allow`;
  - `reason = allowed_by_default_preference`;
  - `source = default_preference`;
- default preference `allowed = false` returns:
  - `decision = deny`;
  - `reason = blocked_by_default_preference`;
  - `source = default_preference`.

### Fallback deny

Test cases:

- fallback deny applies when user preference and default preference are missing;
- fallback response:
  - `decision = deny`;
  - `reason = fallback_deny`;
  - `source = fallback`.

### Rule order

Test cases:

- global deny stops evaluation before quiet hours;
- quiet hours stop evaluation before user preference;
- user preference is checked before default preference;
- default preference is checked before fallback deny.

### Errors and validation

Test cases:

- unknown user returns `404`;
- unknown notification type returns `404`;
- unknown channel returns `404`;
- unknown user/type/channel are not successful `deny` decisions;
- missing `userId` returns `400 validation_error`;
- missing `notificationType` returns `400 validation_error`;
- missing `channel` returns `400 validation_error`;
- missing `region` returns `400 validation_error`;
- missing `datetime` returns `400 validation_error`;
- invalid datetime returns `400`;
- datetime without timezone offset returns `400`;
- datetime in the past returns `400`;
- extra request body fields return `400 validation_error`;
- invalid `ecosystemCode` returns `400 validation_error`.

### Auth/envelope

Test cases:

- request without Basic Auth returns `401`;
- request with correct Basic Auth reaches controller;
- success response body matches `{ data, requestId }`;
- error response body matches `{ error, requestId }`;
- `requestId` comes from observability context;
- `reason` and `source` match OpenAPI enums.

### Read-only behavior

Test cases:

- evaluation does not create users;
- evaluation does not create notification types;
- evaluation does not create channels;
- evaluation does not create default preferences;
- evaluation does not create user preferences;
- evaluation does not update user preferences;
- evaluation does not create quiet hours;
- evaluation does not update quiet hours;
- evaluation does not create or modify global policies;
- evaluation does not update `updated_at` on read entities.

## 10. Observability Tests

### Context reuse

Test cases:

- events include `requestId` from `ObservabilityContextService`;
- events include `serviceId`;
- events include `correlationId` when available;
- outside HTTP context, events may have `requestId = null`;
- outside HTTP context, events still have `serviceId`.

### Sink behavior

Test cases:

- stdout/application logger sink receives structured records;
- structured record contains required base fields:
  - `eventType`;
  - `requestId`;
  - `serviceId`;
  - `correlationId`;
  - `component`;
  - `operation`;
  - `severity`;
  - `timestamp`;
  - `payload`;
- sink failure does not break main request flow;
- sink failure does not roll back DB transaction;
- fallback logging avoids infinite recursion.

### Domain events

Test cases:

- successful preference update records `preference_changed`;
- successful quiet hours update records `quiet_hours_changed`;
- failed preference update does not record successful change event;
- rolled-back combined preferences/quietHours update does not record successful change event;
- successful evaluation records `notification_decision`;
- evaluation validation error does not record `notification_decision`;
- unknown user/type/channel evaluation error does not record `notification_decision`.

### Error/auth events

Test cases:

- unexpected exception records `service_error`;
- PostgreSQL unavailable error records `service_error`;
- Basic Auth failure records auth failure event or `service_error`;
- Basic Auth misconfiguration records critical auth event;
- auth event does not include credentials;
- service error event does not include raw exception object;
- service error event does not include raw SQL error.

### Metrics

Test cases:

- preference change counter is recorded;
- quiet hours change counter is recorded;
- notification decision counter is recorded;
- allowed decision counter or label is recorded;
- denied decision counter or label is recorded;
- service error counter is recorded;
- auth failure counter is recorded;
- evaluation duration timer is recorded;
- preferences update duration timer is recorded;
- HTTP request duration timer is recorded if implemented;
- metric labels are low-cardinality and safe.

### Observability safety

Test cases:

- events do not contain `Authorization`;
- events do not contain Basic Auth username/password;
- events do not contain decoded credentials;
- events do not contain cookies;
- events do not contain connection strings;
- events do not contain env values;
- events do not contain raw SQL errors;
- events do not contain raw request body;
- metric labels do not contain raw `userId`;
- metric labels do not contain raw `requestId`;
- metric labels do not contain raw error message.

## 11. OpenAPI Contract Tests

Test cases:

- every implemented endpoint exists in `docs/openapi.yaml`;
- every implemented success response follows documented schema;
- every implemented error response follows documented schema;
- every request body rejects fields not allowed by OpenAPI;
- every path param validation matches OpenAPI constraints;
- every enum-like response field matches OpenAPI enum:
  - `decision`;
  - `reason`;
  - `source`;
  - preference `source`;
- Basic Auth security scheme is defined;
- protected endpoints require Basic Auth;
- error envelope is consistent across endpoints.

Optional:

- run OpenAPI schema validation against actual e2e responses if tooling exists.

## 12. End-to-End Business Scenarios

The final solution must cover these assignment scenarios end-to-end.

### Scenario 1: New user and defaults

Steps:

1. Enable internal endpoint.
2. Create user `user-1`.
3. Get preferences.
4. Verify default preferences are returned.

Expected:

- transactional email is allowed;
- marketing email is denied;
- quiet hours are `null`;
- response has `{ data, requestId }`.

### Scenario 2: User changes marketing email preference

Steps:

1. Create user.
2. Update `marketing + email` to `allowed = false`.
3. Get preferences.
4. Evaluate `marketing + email`.

Expected:

- GET reflects user preference;
- evaluation returns deny by user preference;
- transactional email remains allowed.

### Scenario 3: Quiet hours block marketing push

Steps:

1. Create user.
2. Set quiet hours `22:00-08:00` in an IANA timezone.
3. Evaluate marketing push at a datetime inside quiet hours.
4. Evaluate transactional/security notification at the same datetime.

Expected:

- marketing push is denied by quiet hours;
- transactional/security notification is not denied by quiet hours if `respects_quiet_hours = false`.

### Scenario 4: Global policy blocks marketing SMS in EU

Steps:

1. Ensure test global policy `marketing + sms + EU = deny` exists.
2. Create user.
3. Set user preference allowing marketing SMS.
4. Evaluate marketing SMS in EU.

Expected:

- decision is deny;
- reason is `blocked_by_global_policy`;
- source is `global_policy`;
- global policy has priority over user preference.

### Scenario 5: Idempotency

Steps:

1. Create user.
2. Apply the same preference update twice.
3. Apply the same quiet hours update twice.
4. Query DB or API final state.

Expected:

- no duplicate user preferences;
- no duplicate quiet hours;
- final state is the same as after one update;
- repeated user creation does not create duplicate user.

### Scenario 6: Fallback deny

Steps:

1. Create a notification type/channel pair without default preference, or use controlled fixture.
2. Ensure user has no preference for the pair.
3. Evaluate notification.

Expected:

- decision is deny;
- reason is `fallback_deny`;
- source is `fallback`.

## 13. README Requirements

Update README with:

### 13.1 Project overview

Include:

- what Notification Preferences Service does;
- what business rules are supported;
- what is included in MVP;
- what is intentionally not included.

### 13.2 Stack

Include:

- TypeScript;
- Node.js;
- NestJS;
- PostgreSQL;
- Drizzle ORM;
- Basic Auth;
- OpenAPI;
- observability module.

### 13.3 Local setup

Include:

- prerequisites;
- install dependencies;
- environment variables;
- PostgreSQL startup;
- migrations;
- seeds;
- application startup.

Example sections:

```text
pnpm install
pnpm run drizzle:migrate
pnpm run db:seed
pnpm run db:seed:test
pnpm run start:dev
```

### 13.4 Environment variables

Document:

- `DATABASE_URL`;
- `SERVICE_ID`;
- `BASIC_AUTH_USERNAME`;
- `BASIC_AUTH_PASSWORD`;
- `ENABLE_INTERNAL_ENDPOINTS`;
- any other required env variables.

Do not include real secrets.

Use placeholder values.

### 13.5 Tests

Document:

- how to run unit tests;
- how to run e2e tests;
- how to prepare test database;
- how to run all checks.

Example:

```text
pnpm test
pnpm test:e2e
pnpm run build
```

Use actual project scripts.

### 13.6 API examples

Add curl examples for:

- create internal user;
- get user preferences;
- update user preference;
- update quiet hours;
- evaluate notification.

Examples must include Basic Auth usage but must not include real credentials.

Use placeholders:

```text
-u "$BASIC_AUTH_USERNAME:$BASIC_AUTH_PASSWORD"
```

### 13.7 Observability

Document:

- request id behavior;
- `X-Request-Id`;
- `X-Correlation-Id`;
- `SERVICE_ID`;
- structured events;
- stdout/application logger sink;
- non-blocking behavior.

### 13.8 Known limitations

Mention MVP limitations:

- Basic Auth is an MVP compromise;
- Basic Auth must be used only over HTTPS outside local development;
- no OAuth/JWT/mTLS;
- no rate limiting;
- no production observability sink;
- no broker-based user synchronization;
- no global policy management API;
- no multi-profile default preferences;
- no admin UI.

### 13.9 Production improvements

Mention possible improvements:

- replace Basic Auth with OAuth2/JWT/mTLS/service-to-service auth;
- add rate limiting and brute-force protection;
- add broker consumer for user/profile events;
- add global policy management workflow;
- add OpenTelemetry/Prometheus/ClickHouse sink;
- add alerting and dashboards;
- add audit log storage;
- add stricter PII handling or user id hashing;
- add deployment manifests.

## 14. Final Verification Commands

Before final report, run:

```bash
pnpm run build
pnpm test
```

If available, also run:

```bash
pnpm test:e2e
pnpm run drizzle:migrate
pnpm run db:seed
pnpm run db:seed:test
```

Use actual project scripts.

If some command does not exist, state that.

If PostgreSQL is not running, state which e2e/database checks could not be executed and run all available non-database checks.

## 15. Final Acceptance Checklist

The project is ready when:

- build passes;
- tests pass or unavailable checks are explicitly documented;
- PostgreSQL schema matches business logic;
- migrations apply to a clean database;
- base seed is idempotent;
- test seed is idempotent;
- observability context works;
- errors use standard envelope;
- Basic Auth protects enabled endpoints;
- disabled internal endpoint returns `404`;
- User API is idempotent;
- Preferences API supports defaults, overrides, quiet hours and idempotency;
- Preferences combined update is atomic;
- Evaluation API applies rules in the correct order;
- Evaluation API is read-only;
- Observability events/counters/timers work and are non-blocking;
- logs/events do not expose sensitive data;
- README explains setup, tests, API examples and limitations;
- original assignment scenarios are covered.

## 16. Agent Final Report Format

At the end of the task, the agent must report:

- files changed;
- test files added or updated;
- README sections updated;
- test database setup used;
- commands executed;
- command results;
- tests that pass;
- tests that could not be executed, with exact reason;
- original assignment scenarios covered;
- known limitations documented;
- any requirement that remains uncovered.
