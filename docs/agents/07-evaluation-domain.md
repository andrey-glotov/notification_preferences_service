# Agent 07: Evaluation Domain

## Goal

Implement the notification delivery decision API:

```text
POST /api/:ecosystemCode/evaluate
```

The endpoint must return:

- `allow` or `deny`;
- stable machine-readable `reason`;
- stable machine-readable `source`.

The evaluation domain is read-only.

It must not modify:

- users;
- user preferences;
- quiet hours;
- default preferences;
- global policies;
- notification types;
- channels.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/01-postgres-schema.md](01-postgres-schema.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/agents/03-errors-module.md](03-errors-module.md);
- [docs/agents/04-basic-auth-guard.md](04-basic-auth-guard.md);
- [docs/agents/05-user-api.md](05-user-api.md);
- [docs/agents/06-preferences-domain.md](06-preferences-domain.md);
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
  - `global_policies`;
- seed data:
  - notification types;
  - channels;
  - default preferences;
  - test global policy;
- observability context:
  - `requestId` for success/error envelopes;
  - `serviceId` and optional `correlationId` for future observability;
- errors module:
  - `ErrorService`;
  - standard error envelope `{ error, requestId }`;
- Basic Auth guard:
  - endpoint must be protected by the global guard;
- Preferences domain:
  - implemented user preferences and quiet hours storage rules.

## Scope

This stage may implement:

- evaluation module;
- evaluation controller;
- evaluation service;
- evaluation repository;
- evaluation DTOs;
- evaluation response types;
- domain types for decision/reason/source;
- tests for evaluation behavior.

This stage must not implement:

- preferences update logic;
- user creation;
- notification type/channel/default preference creation;
- global policies management API;
- observability sink;
- production notification delivery.

## Recommended Structure

Recommended files:

```text
src/evaluation/
  evaluation.module.ts
  evaluation.controller.ts
  evaluation.service.ts
  evaluation.repository.ts
  evaluation.types.ts
  dto/
    evaluate-notification.dto.ts
    evaluate-notification.response.ts
```

Responsibilities:

- `evaluation.module.ts` registers controller, service, repository and dependencies;
- `evaluation.controller.ts` contains `POST /api/:ecosystemCode/evaluate`, DTO validation and success envelope creation;
- `evaluation.service.ts` implements the decision use case and rule order;
- `evaluation.repository.ts` contains Drizzle/PostgreSQL read queries;
- `evaluation.types.ts` contains decision/reason/source domain types if needed;
- `dto/*` contains request/response DTOs matching [docs/openapi.yaml](../openapi.yaml).

Do not put decision logic in the controller.

Do not put persistence queries in the controller.

Do not mutate state in the repository.

## 1. Evaluation Module

Add a dedicated NestJS module:

```text
EvaluationModule
```

Connect it to the root application module:

```text
src/app.module.ts
```

The module must follow the standard NestJS separation:

- controller handles HTTP;
- service handles decision use case and business rules;
- repository handles read-only persistence queries.

## 2. API Contract

Implement endpoint:

```text
POST /api/:ecosystemCode/evaluate
```

The contract must match [docs/openapi.yaml](../openapi.yaml).

Required contract parts:

- path param:
  - `ecosystemCode`;
- request body:
  - `EvaluateNotificationRequest`;
- response body:
  - `EvaluateNotificationEnvelope`;
- errors:
  - `400`;
  - `401`;
  - `404`;
  - `500`;
  - `503`.

Successful response example:

```json
{
  "data": {
    "decision": "deny",
    "reason": "blocked_by_global_policy",
    "source": "global_policy"
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

`requestId` must come from `ObservabilityContextService`.

The controller must not generate its own `requestId`.

## 3. Auth Requirements

Endpoint must pass through the global Basic Auth guard from:

```text
docs/agents/04-basic-auth-guard.md
```

Requirements:

- do not add decorators/metadata that disable the guard;
- do not add route-level auth bypass;
- e2e tests should verify that requests without credentials are rejected;
- e2e tests should verify that requests with valid credentials reach the evaluation controller.

## 4. DTO and Validation

DTOs must be implemented inside the evaluation module.

Path params:

- `ecosystemCode`: string, required, length `1..64`.

`EvaluateNotificationRequest`:

- `userId`: string, required, length `1..128`;
- `notificationType`: string, required, length `1..64`;
- `channel`: string, required, length `1..64`;
- `region`: string, required, length `1..32`;
- `datetime`: string, required, valid ISO date-time with timezone offset.

Validation rules:

- reject missing fields;
- reject invalid path params;
- reject additional fields not described in OpenAPI;
- reject invalid `datetime`;
- reject naive/local datetime without timezone offset;
- reject `datetime` in the past relative to the service clock;
- return `400 validation_error` or `400 bad_request` according to the errors module conventions;
- validation details may include safe field paths;
- validation details must not include the full raw payload.

Valid `datetime` examples:

```text
2027-05-21T21:30:00Z
2027-05-21T21:30:00+03:00
```

Invalid `datetime` examples:

```text
2027-05-21T21:30:00
2027-05-21
not-a-date
```

Tests must generate future datetimes dynamically.

Do not use fixed datetime examples in tests if they can become outdated.

## 5. Domain Lookups

For every evaluation request, load:

- user by `ecosystem_code + external_user_id`;
- notification type by `notification_types.code`;
- channel by `channels.code`.

API field mapping:

```text
path ecosystemCode       -> users.ecosystem_code
body userId              -> users.external_user_id
body notificationType    -> notification_types.code
body channel             -> channels.code
```

Errors:

- if user is not found, return `404 not_found`;
- if notification type is not found, return `404 not_found`;
- if channel is not found, return `404 not_found`.

Use `ErrorService.notFound(...)`.

Do not build error responses manually.

Example:

```ts
throw errorService.notFound({
  message: 'Notification type was not found.',
  details: { notificationType },
  component: 'evaluation',
  operation: 'evaluate_notification',
});
```

Do not create missing users, notification types or channels.

## 6. Decision Reasons vs API Error Codes

Successful evaluation responses must contain only business decision reasons.

Missing entities must be API errors, not successful `deny` decisions.

Do not return:

```json
{
  "data": {
    "decision": "deny",
    "reason": "user_not_found",
    "source": "fallback"
  },
  "requestId": "req_..."
}
```

Instead:

- unknown user -> `404 not_found`;
- unknown notification type -> `404 not_found`;
- unknown channel -> `404 not_found`.

Allowed business decision reasons should match OpenAPI and may include:

- `blocked_by_global_policy`;
- `blocked_by_quiet_hours`;
- `allowed_by_user_preference`;
- `blocked_by_user_preference`;
- `allowed_by_default_preference`;
- `blocked_by_default_preference`;
- `fallback_deny`.

Allowed sources should match OpenAPI and may include:

- `global_policy`;
- `quiet_hours`;
- `user_preference`;
- `default_preference`;
- `fallback`.

## 7. Decision Order

Apply rules strictly in this order:

1. Global deny policy.
2. Quiet hours, only if notification type has `respects_quiet_hours = true`.
3. User preference.
4. Default preference.
5. Fallback deny.

Order is important.

The first matching rule stops evaluation and returns the decision.

## 8. Global Policies

Check only matching global `deny` policies in the MVP.

Policy match rules:

- `notification_type_id` equals requested notification type id or is `null`;
- `channel_id` equals requested channel id or is `null`;
- `region` equals request `region` or is `null`;
- `effect = deny`.

If multiple deny policies match:

- select the policy with the highest `priority`;
- if priorities are equal, use deterministic ordering, for example:
  - `created_at asc`;
  - then `id asc`.

Result when blocked:

```json
{
  "decision": "deny",
  "reason": "blocked_by_global_policy",
  "source": "global_policy"
}
```

Important:

- `global_policies.reason` may be used for audit/logging;
- public evaluation `reason` must be a stable enum from OpenAPI;
- schema may support `allow` policies for future compatibility;
- global `allow` policies must not change MVP evaluation behavior unless business logic and OpenAPI are explicitly updated.

## 9. Quiet Hours

Quiet hours apply only if all conditions are true:

- user has a `quiet_hours` record;
- notification type has `respects_quiet_hours = true`;
- input `datetime`, converted to the quiet-hours timezone, falls inside the quiet-hours interval.

Time rules:

- request `datetime` is an instant, for example `2027-05-21T21:30:00Z`;
- before comparison, convert the instant to the IANA timezone stored in `quiet_hours.timezone`;
- compare only local time in that timezone;
- `start_time < end_time` means same-day interval;
- `start_time > end_time` means interval crossing midnight;
- `start_time = end_time` should not exist because schema/validation reject it.

If `start_time = end_time` is found in the database anyway:

- treat it as configuration/data integrity error;
- return safe `internal_server_error` or `service_unavailable` depending on implementation conventions;
- do not expose raw database details.

Result when blocked:

```json
{
  "decision": "deny",
  "reason": "blocked_by_quiet_hours",
  "source": "quiet_hours"
}
```

If notification type has:

```text
respects_quiet_hours = false
```

then quiet hours must be skipped completely.

Examples:

- transactional notifications may remain allowed during quiet hours;
- security notifications may remain allowed during quiet hours.

## 10. User Preference

Find `user_preferences` by:

```text
user_id + notification_type_id + channel_id
```

If record exists:

- `allowed = true` returns:
  - `decision = allow`;
  - `reason = allowed_by_user_preference`;
  - `source = user_preference`;
- `allowed = false` returns:
  - `decision = deny`;
  - `reason = blocked_by_user_preference`;
  - `source = user_preference`.

User preference overrides default preference.

## 11. Default Preference

If user preference is not found, find `default_preferences` by:

```text
notification_type_id + channel_id
```

If record exists:

- `allowed = true` returns:
  - `decision = allow`;
  - `reason = allowed_by_default_preference`;
  - `source = default_preference`;
- `allowed = false` returns:
  - `decision = deny`;
  - `reason = blocked_by_default_preference`;
  - `source = default_preference`.

Default preferences are a singleton default set for the whole service.

## 12. Fallback Deny

If neither user preference nor default preference exists, return:

```json
{
  "decision": "deny",
  "reason": "fallback_deny",
  "source": "fallback"
}
```

Fallback deny is required so the service never allows sending notifications when configuration is incomplete.

## 13. ErrorService Usage

The evaluation module must use `ErrorService`.

The module must not manually build error responses.

Expected errors:

| Scenario | ErrorService method | HTTP status |
| --- | --- | --- |
| DTO validation failed | `validation` | `400` |
| Invalid datetime | `badRequest` or `validation` | `400` |
| Datetime without timezone offset | `badRequest` or `validation` | `400` |
| Datetime in the past | `badRequest` | `400` |
| User not found | `notFound` | `404` |
| Notification type not found | `notFound` | `404` |
| Channel not found | `notFound` | `404` |
| Data integrity/configuration error | `internal` | `500` |
| PostgreSQL unavailable | `serviceUnavailable` | `503` |

Safe details example:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1",
  "notificationType": "marketing",
  "channel": "email",
  "region": "EU"
}
```

Do not include in details:

- headers;
- credentials;
- `Authorization`;
- connection strings;
- raw SQL errors;
- raw request body;
- environment values;
- stack traces.

## 14. Observability Context Usage

This stage does not need to implement the final observability sink.

The evaluation module must use the existing observability context:

- success response envelope uses `requestId`;
- errors use `requestId` through the errors module;
- future domain events can use `requestId`, `serviceId` and `correlationId`.

Potential future event:

```text
notification_decision
```

The event should contain safe metadata:

- `ecosystemCode`;
- `userId`;
- `notificationType`;
- `channel`;
- `region`;
- `datetime`;
- `decision`;
- `reason`;
- `source`;
- `durationMs`.

Do not implement the final observability sink in this stage.

If a minimal observability service already exists, the service may call it only if this does not expand the task scope and the sink is non-blocking.

## 15. Read-Only Requirement

Evaluation must be read-only.

Do not modify:

- `users`;
- `notification_types`;
- `channels`;
- `default_preferences`;
- `user_preferences`;
- `quiet_hours`;
- `global_policies`.

Do not create missing data on the fly.

Do not update `updated_at`.

Do not write audit rows in this stage unless a dedicated observability sink already exists and is explicitly designed to be non-blocking.

## 16. What Not to Do

Do not implement:

- preferences update API;
- user creation;
- notification type creation;
- channel creation;
- default preference creation;
- global policies management API;
- final observability sink;
- production notification delivery.

Do not add Basic Auth bypass.

Do not change OpenAPI unless required by a real contract inconsistency.

## 17. Tests

Add unit and/or e2e tests for Evaluation API.

Minimum scenarios:

### Global policies

- global deny policy blocks sending;
- global deny policy has priority over user preference;
- global deny policy has priority over default preference;
- higher priority global policy is selected first;
- equal priority global policies produce deterministic result;
- wildcard policy with `notification_type_id = null` matches any type;
- wildcard policy with `channel_id = null` matches any channel;
- wildcard policy with `region = null` matches any region;
- global `allow` policies do not affect MVP evaluation behavior.

### Quiet hours

- quiet hours block notification type with `respects_quiet_hours = true`;
- quiet hours do not block notification type with `respects_quiet_hours = false`;
- quiet hours crossing midnight, for example `22:00-08:00`, work correctly;
- same-day quiet hours, for example `13:00-15:00`, work correctly;
- datetime is converted to the user's IANA timezone before comparison.

### User/default preferences

- user preference `allowed = true` returns `allow`;
- user preference `allowed = false` returns `deny`;
- user preference overrides default preference;
- default preference is used when user preference is absent;
- default preference `allowed = true` returns `allow`;
- default preference `allowed = false` returns `deny`;
- fallback deny applies when user/default preference is missing.

### Errors and validation

- unknown user returns `404`;
- unknown notification type returns `404`;
- unknown channel returns `404`;
- unknown user/type/channel are not returned as successful `deny` decisions;
- invalid `datetime` returns `400`;
- datetime without timezone offset returns `400`;
- datetime in the past returns `400`;
- extra request body fields return `400 validation_error`;
- invalid `ecosystemCode` returns `400 validation_error`;
- missing required fields return `400 validation_error`.

### Auth and envelope

- request without Basic Auth returns `401`;
- request with correct Basic Auth reaches the controller;
- success response body matches `{ data, requestId }`;
- error response body matches `{ error, requestId }`;
- `requestId` comes from observability context;
- `reason` and `source` match OpenAPI enums.

### Read-only behavior

- evaluation does not create users;
- evaluation does not create preferences;
- evaluation does not update preferences;
- evaluation does not create dictionaries;
- evaluation does not modify global policies.

If e2e tests require PostgreSQL and it is not running, add focused unit tests and clearly report which e2e checks could not be executed.

## 18. Verification

Before reporting completion, run:

```bash
pnpm run build
```

If the project has a test script, run:

```bash
pnpm test
```

If PostgreSQL is required for e2e tests and is not running, clearly state this in the final report and execute available unit/build checks.

## 19. Completion Criteria

The task is complete when:

- `EvaluationModule` exists;
- `EvaluationModule` is connected to the root application module;
- `POST /api/:ecosystemCode/evaluate` works;
- DTOs and responses match [docs/openapi.yaml](../openapi.yaml);
- DTO rejects extra fields;
- DTO rejects invalid datetime;
- DTO rejects datetime without timezone offset;
- DTO rejects datetime in the past;
- successful response returns `{ data, requestId }`;
- `requestId` comes from observability context;
- decision order matches [docs/business-logic.md](../business-logic.md);
- global deny policy has the highest priority;
- global allow policy does not affect MVP evaluation;
- quiet hours use IANA timezone conversion;
- quiet hours crossing midnight are handled correctly;
- quiet hours apply only to types with `respects_quiet_hours = true`;
- user preference overrides default preference;
- default preference is used when user preference is absent;
- fallback deny works when configuration is incomplete;
- endpoint is protected by global Basic Auth guard;
- evaluation module does not disable the guard;
- errors are returned through the errors module;
- controller does not contain decision/persistence logic;
- evaluation does not mutate state;
- tests cover required scenarios;
- build passes.

## 20. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `EvaluationModule` is connected;
- how the decision order is implemented;
- how global policy matching and priority are implemented;
- how quiet hours and timezone conversion are implemented;
- how user/default/fallback decisions are implemented;
- how DTO validation rejects invalid datetime and unknown fields;
- how decision reasons are kept separate from API error codes;
- how read-only behavior is preserved;
- which DTO/response classes were added;
- how `requestId` is read from observability context;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
