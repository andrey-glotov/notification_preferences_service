# Agent 06: Preferences Domain

## Goal

Implement the API for reading and updating user notification preferences:

```text
GET /api/:ecosystemCode/users/:userId/preferences
POST /api/:ecosystemCode/users/:userId/preferences
```

This stage implements the preferences module:

- user preferences for `notificationType + channel` pairs;
- quiet hours;
- effective preference reading with default preferences;
- idempotent preference updates.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/01-postgres-schema.md](01-postgres-schema.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/agents/03-errors-module.md](03-errors-module.md);
- [docs/agents/04-basic-auth-guard.md](04-basic-auth-guard.md);
- [docs/agents/05-user-api.md](05-user-api.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml).

## Dependencies from Previous Stages

This stage depends on:

- PostgreSQL schema:
  - `users`;
  - `notification_types`;
  - `channels`;
  - `default_preferences`;
  - `user_preferences`;
  - `quiet_hours`;
- seed data:
  - notification types;
  - channels;
  - default preferences;
- observability context:
  - `requestId` for success/error envelopes;
  - `serviceId` and optional `correlationId` for future observability;
- errors module:
  - `ErrorService`;
  - standard error envelope `{ error, requestId }`;
- Basic Auth guard:
  - endpoints must be protected by the global guard;
- User API or seed/test setup:
  - user must exist before preferences scenarios are executed.

Do not create users automatically inside the preferences module.

## Scope

This stage may implement:

- preferences module;
- preferences controller;
- preferences service;
- preferences repository;
- preferences DTOs;
- preferences response types;
- domain types for preferences;
- idempotent upsert for `user_preferences`;
- idempotent upsert for `quiet_hours`;
- tests for Preferences API behavior.

This stage must not implement:

- evaluation API;
- global policies management API;
- notification send evaluation;
- user creation;
- notification type/channel creation;
- default preference creation;
- observability sink;
- production notification delivery logic.

## Recommended Structure

Recommended files:

```text
src/preferences/
  preferences.module.ts
  preferences.controller.ts
  preferences.service.ts
  preferences.repository.ts
  preferences.types.ts
  dto/
    update-user-preferences.dto.ts
    user-preferences.response.ts
    update-user-preferences.response.ts
```

Responsibilities:

- `preferences.module.ts` registers controller, service, repository and dependencies;
- `preferences.controller.ts` contains routes, DTO validation and success envelope creation;
- `preferences.service.ts` implements use cases for reading and updating preferences;
- `preferences.repository.ts` contains Drizzle/PostgreSQL queries;
- `preferences.types.ts` contains domain types if needed;
- `dto/*` contains request/response DTOs matching [docs/openapi.yaml](../openapi.yaml).

Do not put persistence queries in the controller.

Do not put HTTP response construction in the repository.

## 1. Preferences Module

Add a dedicated NestJS module:

```text
PreferencesModule
```

Connect it to the root application module:

```text
src/app.module.ts
```

The module must follow the standard NestJS separation:

- controller handles HTTP;
- service handles use cases and business rules;
- repository handles persistence.

## 2. API Contract

Implement endpoints:

```text
GET /api/:ecosystemCode/users/:userId/preferences
POST /api/:ecosystemCode/users/:userId/preferences
```

The contract must match [docs/openapi.yaml](../openapi.yaml).

Required contract parts:

For `GET`:

- response:
  - `UserPreferencesEnvelope`;
- errors:
  - `400`;
  - `401`;
  - `404`;
  - `500`.

For `POST`:

- request:
  - `UpdateUserPreferencesRequest`;
- response:
  - `UpdateUserPreferencesEnvelope`;
- errors:
  - `400`;
  - `401`;
  - `404`;
  - `409`;
  - `500`;
  - `503`.

Successful responses must use:

```json
{
  "data": {},
  "requestId": "req_1779604200123456789_a3f91c"
}
```

`requestId` must come from `ObservabilityContextService`.

The controller must not generate its own `requestId`.

## 3. Auth Requirements

Endpoints must pass through the global Basic Auth guard from:

```text
docs/agents/04-basic-auth-guard.md
```

Requirements:

- do not add decorators/metadata that disable the guard;
- do not add route-level auth bypass;
- e2e tests should verify that requests without credentials are rejected;
- e2e tests should verify that requests with valid credentials reach the preferences controller.

## 4. DTO and Validation

DTOs must be implemented inside the preferences module.

Path params:

- `ecosystemCode`: string, required, length `1..64`;
- `userId`: string, required, length `1..128`.

`UpdateUserPreferencesRequest`:

- request body must contain at least one of:
  - `preferences`;
  - `quietHours`;
- `preferences`: optional array, min length `1`;
- `preferences[].notificationType`: string, required, length `1..64`;
- `preferences[].channel`: string, required, length `1..64`;
- `preferences[].allowed`: boolean, required;
- `quietHours.startTime`: string, required if `quietHours` is provided, format `HH:mm`;
- `quietHours.endTime`: string, required if `quietHours` is provided, format `HH:mm`;
- `quietHours.timezone`: string, required if `quietHours` is provided, valid IANA timezone, length `1..64`.

Validation rules:

- reject an empty request body;
- reject request body without both `preferences` and `quietHours`;
- reject `preferences: []`;
- reject malformed `preferences` items;
- reject malformed `quietHours`;
- reject `quietHours.startTime = quietHours.endTime`;
- `startTime < endTime` means an interval within one day;
- `startTime > endTime` means an interval crossing midnight;
- validate timezone as IANA timezone;
- reject additional fields not described in OpenAPI;
- reject additional fields inside nested objects.

DTO validation errors must go through the errors module and return:

```text
validation_error
```

Domain validation errors after DTO validation may use:

```text
bad_request
```

Do not return the raw request body in validation details.

## 5. Domain Lookups

For each request, first find the user by:

```text
ecosystem_code + external_user_id
```

API field mapping:

```text
path ecosystemCode -> users.ecosystem_code
path userId        -> users.external_user_id
```

If the user is not found:

```ts
throw errorService.notFound({
  message: 'User was not found.',
  details: { ecosystemCode, userId },
  component: 'preferences',
  operation: 'get_user_preferences' | 'update_user_preferences',
});
```

For `POST`, validate that every referenced notification type and channel exists:

- if notification type is not found, return `404 not_found`;
- if channel is not found, return `404 not_found`;
- do not create notification types on the fly;
- do not create channels on the fly.

For `GET`, dictionaries are read from the database together with default/user preferences.

## 6. GET Preferences

`GET /api/:ecosystemCode/users/:userId/preferences` must return:

- `ecosystemCode`;
- `userId`;
- array of effective preferences;
- `quietHours`, if configured;
- `quietHours: null`, if not configured.

Effective preferences must be built from the singleton `default_preferences` set.

Rules:

- for each default preference pair, return an effective preference;
- if a matching `user_preferences` row exists, it overrides the default;
- if no matching user preference exists, use default preference;
- `source = user_preference` for user-specific values;
- `source = default_preference` for default values;
- do not include pairs that have no default preference unless OpenAPI/business docs explicitly require that.

Expected effective preference fields should match OpenAPI, typically:

- `notificationType`;
- `channel`;
- `allowed`;
- `source`.

The query/repository design should avoid N+1 queries where reasonable for the MVP.

## 7. POST Preferences

`POST /api/:ecosystemCode/users/:userId/preferences` must idempotently update:

- `user_preferences`;
- `quiet_hours`.

The request may contain:

- only `preferences`;
- only `quietHours`;
- both `preferences` and `quietHours`.

If only `preferences` is provided:

- quiet hours must not be changed.

If only `quietHours` is provided:

- user preferences must not be changed.

If both are provided:

- both must be updated atomically in one transaction.

### 7.1 User Preferences Update

Upsert by:

```text
user_id + notification_type_id + channel_id
```

Rules:

- repeated request with the same payload must not create duplicates;
- if `allowed` changes, update the row and `updated_at`;
- if `allowed` does not change, final state remains the same;
- do not create notification types or channels on the fly;
- do not create user automatically.

### 7.2 Quiet Hours Update

Upsert by:

```text
user_id
```

Rules:

- repeated request with the same payload must not create duplicates;
- timezone must be stored as an IANA timezone string;
- `start_time` and `end_time` must be stored as local `time`;
- `startTime = endTime` must be rejected;
- interval crossing midnight must be allowed.

### 7.3 Atomicity

If a single request updates both `preferences` and `quietHours`, the update must be atomic.

Use one database transaction.

If any part fails:

- no partial update must remain;
- return the appropriate error through `ErrorService`.

Response example:

```json
{
  "data": {
    "ecosystemCode": "vk",
    "userId": "user-1",
    "updated": true
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

## 8. ErrorService Usage

The preferences module must use `ErrorService`.

The module must not manually build error responses.

Expected errors:

| Scenario | ErrorService method | HTTP status |
| --- | --- | --- |
| DTO validation failed | `validation` | `400` |
| Invalid IANA timezone | `badRequest` | `400` |
| `startTime = endTime` | `badRequest` or `validation` | `400` |
| User not found | `notFound` | `404` |
| Notification type not found | `notFound` | `404` |
| Channel not found | `notFound` | `404` |
| State conflict not resolvable by upsert | `conflict` | `409` |
| Unexpected application error | `internal` | `500` |
| PostgreSQL unavailable | `serviceUnavailable` | `503` |

Safe details example:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1",
  "notificationType": "marketing",
  "channel": "email"
}
```

Do not include in details:

- headers;
- credentials;
- `Authorization`;
- connection strings;
- raw SQL errors;
- raw request body;
- environment values.

## 9. Observability Context Usage

This stage does not need to implement the final observability sink.

The preferences module must use the existing observability context:

- success response envelope uses `requestId`;
- errors use `requestId` through the errors module;
- future domain events can use `requestId`, `serviceId` and `correlationId`.

Potential future events:

- `preference_changed`;
- `quiet_hours_changed`.

Do not implement the final observability sink in this stage.

If a minimal observability service already exists, the service may call it only if this does not expand the task scope and the sink is non-blocking.

## 10. What Not to Do

Do not implement:

- evaluation API;
- global policies management API;
- notification delivery checks;
- user creation;
- notification type creation;
- channel creation;
- default preference creation;
- final observability sink;
- Basic Auth bypass;
- production notification delivery logic.

Do not create users automatically inside the preferences module.

Do not change OpenAPI unless required by a real contract inconsistency.

## 11. Tests

Add unit and/or e2e tests for Preferences API.

Minimum scenarios:

### GET

- `GET` for a new existing user returns default preferences;
- `GET` returns `quietHours: null` if quiet hours are not configured;
- `GET` returns user preference values overriding default preferences;
- `GET` returns `source = default_preference` for default values;
- `GET` returns `source = user_preference` for overridden values;
- unknown user returns `404`.

### POST user preferences

- `POST` creates a user preference;
- `POST` updates an existing user preference;
- result after `POST` is reflected in `GET`;
- repeated `POST` with the same preference does not create duplicate;
- unknown user returns `404`;
- unknown notification type returns `404`;
- unknown channel returns `404`.

### POST quiet hours

- `POST` creates quiet hours;
- `POST` updates quiet hours;
- repeated `POST` with same quiet hours does not create duplicate;
- `POST` with `startTime = endTime` returns `400`;
- `POST` with non-IANA timezone returns `400`;
- quiet hours crossing midnight, for example `22:00-08:00`, are stored correctly.

### Request validation

- empty body returns `400 validation_error`;
- body without `preferences` and `quietHours` returns `400 validation_error`;
- `preferences: []` returns `400 validation_error`;
- extra body fields return `400 validation_error`;
- extra nested fields return `400 validation_error`;
- invalid `ecosystemCode` returns `400 validation_error`;
- invalid `userId` returns `400 validation_error`.

### Auth and envelope

- request without Basic Auth returns `401`;
- request with correct Basic Auth reaches the controller;
- success response body matches `{ data, requestId }`;
- error response body matches `{ error, requestId }`;
- `requestId` comes from observability context.

### Atomicity

- if a request contains both preferences and quiet hours and one part fails, no partial update remains.

If e2e tests require PostgreSQL and it is not running, add focused unit tests and clearly report which e2e checks could not be executed.

## 12. Verification

Before reporting completion, run:

```bash
pnpm run build
```

If the project has a test script, run:

```bash
pnpm test
```

If PostgreSQL is required for e2e tests and is not running, clearly state this in the final report and execute available unit/build checks.

## 13. Completion Criteria

The task is complete when:

- `PreferencesModule` exists;
- `PreferencesModule` is connected to the root application module;
- `GET /api/:ecosystemCode/users/:userId/preferences` works;
- `POST /api/:ecosystemCode/users/:userId/preferences` works;
- DTOs and responses match [docs/openapi.yaml](../openapi.yaml);
- successful responses return `{ data, requestId }`;
- `requestId` comes from observability context;
- GET returns default preferences for an existing user without individual settings;
- user preferences override default preferences;
- quiet hours are linked to `users.id`;
- user preferences upsert is idempotent;
- quiet hours upsert is idempotent;
- update of preferences + quiet hours in one request is atomic;
- endpoints are protected by the global Basic Auth guard;
- preferences module does not disable the guard;
- errors are returned through the errors module;
- controller does not contain persistence/business logic;
- module does not create users automatically;
- module does not create dictionaries/defaults on the fly;
- changes do not implement evaluation domain;
- tests cover required scenarios;
- build passes.

## 14. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `PreferencesModule` is connected;
- how GET effective preferences are implemented;
- how user preference overrides default preference;
- how idempotent upsert for `user_preferences` is implemented;
- how idempotent upsert for `quiet_hours` is implemented;
- how atomic update is implemented when both preferences and quiet hours are provided;
- how DTO validation rejects unknown fields;
- how IANA timezone validation is implemented;
- which DTO/response classes were added;
- how `requestId` is read from observability context;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
