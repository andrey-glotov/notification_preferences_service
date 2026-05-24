# Agent 05: User API

## Goal

Implement the internal API for creating and updating a local user projection:

```text
POST /internal/:ecosystemCode/users
```

This endpoint is intended for tests and local verification without connecting a message broker.

In a production architecture, users should be created or updated from events published by a user/profile service.

The endpoint must be optional and controlled by an environment flag.

If the endpoint is disabled, the service must return `404 Not Found` to avoid revealing the existence of the internal API.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/01-postgres-schema.md](01-postgres-schema.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/agents/03-errors-module.md](03-errors-module.md);
- [docs/agents/04-basic-auth-guard.md](04-basic-auth-guard.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml);
- [docs/security-notes.md](../security-notes.md).

## Dependencies from Previous Stages

This stage depends on:

- PostgreSQL schema:
  - `users` table;
  - unique constraint on `ecosystem_code + external_user_id`;
- observability context:
  - `requestId` for success/error envelopes;
  - `serviceId` and optional `correlationId` for future observability;
- errors module:
  - `ErrorService`;
  - standard error envelope `{ error, requestId }`;
- Basic Auth guard:
  - the endpoint must be protected when enabled.

Do not add an auth bypass for:

```text
/internal/:ecosystemCode/users
```

## Scope

This stage may implement:

- users module;
- users controller;
- users service;
- users repository;
- users DTOs;
- users response types;
- config extension for `ENABLE_INTERNAL_ENDPOINTS`;
- dedicated internal endpoint availability guard;
- tests for internal user API behavior.

This stage must not implement:

- preferences API;
- evaluation API;
- default/user preferences creation during user creation;
- broker/event consumer;
- full user profile model;
- observability sink;
- production user synchronization.

## Recommended Structure

Recommended files:

```text
src/users/
  users.module.ts
  users.controller.ts
  users.service.ts
  users.repository.ts
  users.types.ts
  dto/
    create-internal-user.dto.ts
    internal-user.response.ts
```

Responsibilities:

- `users.module.ts` registers controller, service, repository and dependencies;
- `users.controller.ts` contains HTTP route, DTO validation and success envelope creation;
- `users.service.ts` implements the use case of idempotent local user projection creation/update;
- `users.repository.ts` contains Drizzle/PostgreSQL queries;
- `users.types.ts` contains internal module types if needed;
- `internal-endpoint.guard.ts` or equivalent guard checks `ENABLE_INTERNAL_ENDPOINTS`;
- `dto/create-internal-user.dto.ts` defines request DTO;
- `dto/internal-user.response.ts` defines response DTO/envelope types.

Do not put persistence queries in the controller.

Do not put HTTP response construction in the repository.

## 1. Users Module

Add a dedicated NestJS module:

```text
UsersModule
```

Connect it to the root application module:

```text
src/app.module.ts
```

The module must follow the standard NestJS separation:

- controller handles HTTP;
- service handles the use case;
- repository handles persistence.

## 2. API Contract

Implement:

```text
POST /internal/:ecosystemCode/users
```

The contract must match [docs/openapi.yaml](../openapi.yaml).

Required contract parts:

- path param:
  - `ecosystemCode`;
- request body:
  - `CreateInternalUserRequest`;
- response body:
  - `InternalUserEnvelope`;
- errors:
  - `400`;
  - `401`;
  - `404`;
  - `500`.

Successful response example:

```json
{
  "data": {
    "id": "018f7e52-7d2a-7f20-a1e0-1b9ffb3a8a11",
    "ecosystemCode": "vk",
    "userId": "user-1",
    "region": "EU"
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

`requestId` must come from `ObservabilityContextService`.

The controller must not generate its own `requestId`.

## 3. Internal Endpoint Flag

The endpoint must be available only when:

```text
ENABLE_INTERNAL_ENDPOINTS=true
```

Default value:

```text
false
```

Rules:

- if the flag is disabled, `POST /internal/:ecosystemCode/users` must return `404 Not Found`;
- if the flag is disabled, the service must not create or update a user;
- if the flag is disabled, the public response must not reveal that the endpoint exists but is disabled;
- config must be read through the existing config layer;
- do not read `process.env` directly in controller/service if the project has a config module.

Recommended public error:

```json
{
  "error": {
    "code": "not_found",
    "message": "Resource was not found.",
    "details": null
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

## 4. Internal Endpoint Availability Guard

The `ENABLE_INTERNAL_ENDPOINTS` check must be implemented through a dedicated NestJS guard.

Recommended name:

```text
InternalEndpointGuard
```

The guard must be responsible only for checking whether internal endpoints are enabled.

The guard must:

- read `ENABLE_INTERNAL_ENDPOINTS` from the config layer;
- treat missing value as `false`;
- allow the request only when `ENABLE_INTERNAL_ENDPOINTS=true`;
- throw `ErrorService.notFound(...)` when internal endpoints are disabled;
- return the standard error envelope through the errors module;
- use `requestId` from observability context;
- avoid revealing that the endpoint exists but is disabled;
- contain no user creation/update logic;
- contain no Basic Auth logic.

Recommended error:

```ts
throw errorService.notFound({
  message: 'Resource was not found.',
  details: null,
  component: 'users',
  operation: 'internal_endpoint_availability',
});
```

The guard should be applied only to internal endpoints, not to public `/api/...` endpoints.

For this task, apply it to:

```text
POST /internal/:ecosystemCode/users
```

Recommended guard order for enabled internal endpoint:

```text
ObservabilityMiddleware
  -> InternalEndpointGuard
  -> BasicAuthGuard
  -> UsersController
```

Required behavior:

- when `ENABLE_INTERNAL_ENDPOINTS=false`, response must be `404`;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, Basic Auth challenge should not reveal the endpoint;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, request must still pass Basic Auth;
- when `ENABLE_INTERNAL_ENDPOINTS=true` and credentials are missing/invalid, response must be `401`;
- when `ENABLE_INTERNAL_ENDPOINTS=true` and credentials are valid, request reaches the controller.

Important implementation note:

If the project uses a global Basic Auth guard through `APP_GUARD`, guard ordering must be handled explicitly.

Acceptable approaches:

1. Register `InternalEndpointGuard` globally before `BasicAuthGuard`, but make it a no-op for non-internal routes.
2. Register `InternalEndpointGuard` locally on internal controllers/routes and ensure it runs before Basic Auth.
3. Use a documented framework-specific approach that preserves the required behavior.

Do not silently return `401` for disabled internal endpoints unless the documentation is updated.

## 5. DTO and Validation

## 4. DTO and Validation

Implement DTOs inside the users module.

Path params:

- `ecosystemCode`: string, required, length `1..64`.

Request body:

- `userId`: string, required, length `1..128`;
- `region`: string or `null`, optional, max length `32`.

Validation rules:

- reject missing `userId`;
- reject invalid `ecosystemCode`;
- reject too long `userId`;
- reject too long `region`;
- allow omitted `region`;
- allow `region: null` if the selected semantics support clearing region;
- reject additional fields not defined in OpenAPI;
- do not accept or store additional user profile fields.

DTO validation errors must go through the errors module and return:

```text
validation_error
```

Do not return the raw request body in validation details.

## 6. Persistence Logic

The `users` table stores:

- local `id`;
- `ecosystem_code`;
- `external_user_id`;
- `region`;
- `created_at`;
- `updated_at`.

The service must use local internal `users.id` for relations.

External identity must be stored as:

```text
ecosystem_code + external_user_id
```

API field mapping:

```text
path ecosystemCode -> users.ecosystem_code
body userId       -> users.external_user_id
```

The service must not store full user profiles.

Only the minimum data needed by Notification Preferences Service should be stored.

## 7. Idempotency

User creation/update must be idempotent by:

```text
ecosystemCode + userId
```

Rules:

- if the user does not exist, create a new local projection;
- if the user already exists and payload is the same, return the existing final state without creating duplicates;
- if the user already exists and a new `region` is provided, update `region`;
- if the user already exists and `region` is omitted, keep the existing `region`;
- if the user already exists and `region` is `null`, clear the region if this semantic is implemented;
- repeated requests with the same payload must leave the database in the same final state.

Preferred implementation:

```text
PostgreSQL upsert on unique(ecosystem_code, external_user_id)
```

The upsert must preserve the “omitted region does not clear existing region” behavior.

If Drizzle upsert syntax makes this behavior hard to express in one query, implement it safely in service/repository logic and explain the approach in the final report.

## 8. ErrorService Usage

The user module must use `ErrorService`.

The module must not manually build error responses.

Expected errors:

| Scenario | ErrorService method | HTTP status |
| --- | --- | --- |
| DTO validation failed | `validation` | `400` |
| Safe domain validation error | `badRequest` | `400` |
| Internal endpoint disabled | `notFound` | `404` |
| State conflict not resolvable by upsert | `conflict` | `409` |
| Unexpected application error | `internal` | `500` |
| PostgreSQL unavailable | `serviceUnavailable` | `503` |

Important rule:

`notFound` in this endpoint is used for the disabled internal endpoint case.

Normal idempotent create/update flow must not return `notFound`.

Safe details example:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1"
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

## 9. Auth Requirements

The endpoint must pass through the global Basic Auth guard when enabled.

Requirements:

- do not add decorators/metadata that disable the Basic Auth guard when the endpoint is enabled;
- do not add local bypass for `/internal/:ecosystemCode/users`;
- use `InternalEndpointGuard` or equivalent availability guard for `ENABLE_INTERNAL_ENDPOINTS`;
- e2e tests should verify that requests without credentials are rejected when the endpoint is enabled;
- e2e tests should verify that requests with valid credentials reach the user controller when the endpoint is enabled.

If the endpoint is disabled, the expected public behavior is `404 Not Found` according to the internal endpoint security rule.

## 10. Observability Context Usage

This stage does not need to implement the final observability sink.

The user module must use the existing observability context:

- successful response envelope uses `requestId`;
- errors use `requestId` through the errors module;
- user service may prepare safe metadata for future events.

Potential future events:

- `user_created`;
- `user_create_idempotent`;
- `user_region_updated`.

Do not implement final observability events unless a minimal observability service already exists and the implementation does not expand the scope.

Do not log sensitive data.

## 11. What Not to Do

Do not implement:

- preferences API;
- evaluation API;
- default preferences creation during user creation;
- user preferences creation during user creation;
- broker consumer;
- production-grade user profile model;
- final observability sink;
- production authorization model;
- Basic Auth bypass;
- route that is always enabled regardless of `ENABLE_INTERNAL_ENDPOINTS`.

Do not change OpenAPI unless required by a real contract inconsistency.

Do not add extra user profile fields that are not in [docs/business-logic.md](../business-logic.md).

## 12. Tests

Add unit and/or e2e tests for User API.

Minimum scenarios:

- `POST /internal/:ecosystemCode/users` creates a new user when enabled;
- successful response matches `{ data, requestId }`;
- `data.id` is a local UUID;
- `data.ecosystemCode` matches path param;
- `data.userId` matches request body `userId`;
- repeated request with same `ecosystemCode + userId` does not create duplicate;
- repeated request with same payload returns the same final state;
- repeated request with new `region` updates region;
- request without `region` does not clear already stored region;
- `region: null` clears region if this semantic is implemented;
- request with extra body fields returns `400 validation_error`;
- invalid `ecosystemCode` returns `400 validation_error`;
- invalid `userId` returns `400 validation_error`;
- too long `region` returns `400 validation_error`;
- request without Basic Auth returns `401` when endpoint is enabled;
- request with correct Basic Auth reaches the controller when endpoint is enabled;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, endpoint returns `404`;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, user is not created or updated;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, response does not include a Basic Auth challenge that reveals the endpoint;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, request without Basic Auth returns `401`;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, endpoint is available after successful Basic Auth;
- raw headers/credentials are not present in error details.

If e2e tests require PostgreSQL and it is not running, add focused unit tests and clearly report which e2e checks could not be executed.

## 13. Verification

Before reporting completion, run:

```bash
pnpm run build
```

If the project has a test script, run:

```bash
pnpm test
```

If PostgreSQL is required for e2e tests and is not running, clearly state this in the final report and execute available unit/build checks.

## 14. Completion Criteria

The task is complete when:

- `UsersModule` exists;
- `UsersModule` is connected to the root application module;
- `POST /internal/:ecosystemCode/users` works when enabled;
- endpoint is controlled by `ENABLE_INTERNAL_ENDPOINTS=true`;
- default value for `ENABLE_INTERNAL_ENDPOINTS` is `false`;
- internal endpoint availability is implemented through a dedicated guard;
- disabled endpoint returns `404`;
- disabled endpoint does not create or update users;
- DTOs and responses match [docs/openapi.yaml](../openapi.yaml);
- successful response returns `{ data, requestId }`;
- `requestId` comes from observability context;
- user is stored as local projection with `ecosystem_code + external_user_id`;
- creation/update is idempotent by `ecosystemCode + userId`;
- repeated requests do not create duplicates;
- endpoint is protected by the global Basic Auth guard when enabled;
- user module does not bypass the guard;
- errors are returned through the errors module;
- controller does not contain persistence/business logic;
- changes do not implement preferences/evaluation domains;
- tests cover required scenarios;
- build passes.

## 15. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `UsersModule` is connected;
- how `ENABLE_INTERNAL_ENDPOINTS` is handled;
- how the internal endpoint availability guard is implemented;
- how disabled endpoint returns `404`;
- how Basic Auth protection is preserved for enabled endpoint;
- how idempotent upsert is implemented;
- how omitted `region` and `region: null` are handled;
- which DTO/response classes were added;
- how `requestId` is read from observability context;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
