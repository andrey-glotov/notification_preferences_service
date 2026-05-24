# Agent 04: Basic Auth Guard

## Goal

Implement mandatory Basic Auth for all enabled HTTP endpoints through a NestJS Guard.

This stage covers the MVP authorization requirement.

Basic Auth is an intentional MVP compromise for the assignment. It is not a production-ready access-control model by itself.

Outside local development, Basic Auth must be used only over HTTPS.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/agents/03-errors-module.md](03-errors-module.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/security-notes.md](../security-notes.md);
- [docs/openapi.yaml](../openapi.yaml).

## Dependencies from Previous Stages

This stage depends on:

- observability context:
  - `requestId`;
  - `serviceId`;
  - optional `correlationId`;
- errors module:
  - `ErrorService`;
  - standard error envelope `{ error, requestId }`;
- OpenAPI security scheme:
  - `basicAuth`.

The guard must not build HTTP response bodies manually.

The guard must throw `ApplicationError` instances through `ErrorService`.

The global exception filter must convert these errors into the OpenAPI error envelope.

## Scope

This stage may implement:

- auth module;
- Basic Auth guard;
- Basic Auth service/helper;
- auth config;
- global guard registration;
- tests for Basic Auth behavior.

This stage must not implement:

- OAuth;
- JWT;
- API keys;
- HMAC;
- mTLS;
- roles/scopes/permissions;
- rate limiting;
- user API;
- preferences API;
- evaluation API;
- observability sink;
- production auth model.

## Recommended Structure

Recommended files:

```text
src/auth/
  auth.module.ts
  basic-auth.guard.ts
  basic-auth.service.ts
  auth.config.ts
```

If the project already has a config module, auth config should be added there instead of creating an isolated config mechanism.

Do not read `process.env` directly inside the guard if the project has a config layer.

## 1. Auth Module

Add a dedicated NestJS module:

```text
AuthModule
```

The module must be connected to the root application module:

```text
src/app.module.ts
```

The Basic Auth guard must be applied globally to all enabled HTTP endpoints through a provider, for example:

```ts
APP_GUARD
```

The guard must protect:

- public API endpoints under `/api/...`;
- enabled internal endpoints under `/internal/...`.

Do not add a local bypass for `/internal/...`.

## 2. Credentials Configuration

Credentials must come only from configuration/environment variables:

```text
BASIC_AUTH_USERNAME
BASIC_AUTH_PASSWORD
```

Rules:

- do not hardcode credentials in code;
- do not hardcode credentials in fixtures;
- do not hardcode credentials in documentation examples;
- do not log credentials;
- do not expose credentials in errors;
- do not include credentials in test snapshots.

If credentials are missing or empty:

- the service is misconfigured;
- the request must fail safely;
- the client may receive `500 internal_server_error`;
- the public error must not reveal which env value is missing;
- observability metadata should use:
  - `component = auth`;
  - `operation = basic_auth`;
  - `severity = critical`.

Recommended public response for misconfiguration:

```json
{
  "error": {
    "code": "internal_server_error",
    "message": "Internal server error.",
    "details": null
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

## 3. Header Parsing

The guard must read:

```text
Authorization: Basic base64(username:password)
```

Parsing rules:

- `Authorization` header is required;
- auth scheme must be `Basic`;
- scheme comparison must be case-insensitive;
- token after `Basic` is required;
- token must be valid Base64;
- decoded value must contain `:`;
- decoded value must be split by the first `:`;
- username may contain any allowed character except `:`;
- password may contain `:`;
- empty username is invalid;
- empty password is invalid.

Do not log:

- raw `Authorization` header;
- Base64 token;
- decoded credentials;
- username;
- password.

## 4. Credential Verification

Username and password comparison must be safe.

Requirements:

- use constant-time comparison, for example `crypto.timingSafeEqual`;
- convert values to `Buffer` before comparison;
- handle different string lengths safely;
- do not leak whether username or password was incorrect;
- invalid username and invalid password must produce the same public error;
- malformed header and incorrect credentials must not expose internal details.

Recommended behavior:

- parse and validate the header;
- if malformed, throw `unauthorized`;
- if credentials are wrong, throw `unauthorized`;
- if auth config is missing, throw `internal`.

Public error for auth failures:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Authentication is required.",
    "details": null
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

HTTP status:

```text
401 Unauthorized
```

## 5. `WWW-Authenticate` Header

Every `401 Unauthorized` response produced by Basic Auth must include:

```text
WWW-Authenticate: Basic realm="Notification Preferences Service"
```

This header is required for:

- missing credentials;
- malformed credentials;
- incorrect credentials.

The header is part of the documented API/security behavior.

If the team decides to remove or change this header, update these documents first:

- [docs/openapi.yaml](../openapi.yaml);
- [docs/security-notes.md](../security-notes.md).

## 6. ErrorService Usage

The guard must use `ErrorService`.

Expected style for auth failure:

```ts
throw errorService.unauthorized({
  message: 'Authentication is required.',
  details: null,
  component: 'auth',
  operation: 'basic_auth',
  severity: 'warning',
});
```

Expected style for auth misconfiguration:

```ts
throw errorService.internal({
  message: 'Internal server error.',
  details: null,
  component: 'auth',
  operation: 'basic_auth',
  severity: 'critical',
});
```

Do not pass these values in `details`:

- `Authorization` header;
- Base64 token;
- decoded credentials;
- env values;
- username;
- password;
- request headers.

The global exception filter must produce the final HTTP response.

## 7. Observability Context Usage

The guard must consume the existing observability context.

Expected behavior:

- `requestId` comes from `ObservabilityContextService`;
- `serviceId` comes from `ObservabilityContextService`;
- `correlationId` comes from `ObservabilityContextService`;
- guard must not generate `requestId`;
- guard must not read or validate `X-Request-Id`;
- guard must not create a second context system.

Auth errors must include observability metadata through `ApplicationError` fields so future structured error events can use:

- `requestId`;
- `serviceId`;
- `correlationId`;
- `component`;
- `operation`;
- `severity`.

This stage does not need to implement the final observability sink.

## 8. Internal Endpoints and Disabled Internal API

Internal endpoints are controlled by:

```text
ENABLE_INTERNAL_ENDPOINTS=true
```

Default value:

```text
false
```

Security requirements:

- enabled internal endpoints must require Basic Auth;
- do not add a Basic Auth bypass for `/internal/...`;
- disabled internal endpoints must behave as unavailable routes and return `404 Not Found`;
- when disabled, the service must not create or update data;
- when disabled, the public response must not reveal that an internal endpoint exists but is disabled.

Important implementation note:

If the guard is registered globally through `APP_GUARD`, it may run before route/controller logic.

The implementation must ensure that disabled internal endpoints still follow the documented behavior.

Acceptable approaches:

1. Hide disabled internal endpoints before guard-protected business logic is reached.
2. Register internal routes conditionally only when `ENABLE_INTERNAL_ENDPOINTS=true`.
3. Use an early middleware or routing mechanism to return generic `404` for disabled internal endpoints before auth challenge.

Do not silently change behavior to `401` for disabled internal endpoints unless the documentation is updated.

If the selected NestJS setup makes the required behavior impossible without changing architecture, report this explicitly.

## 9. Scope of Protection

Basic Auth is mandatory for all enabled HTTP endpoints:

- `/api/...`;
- `/internal/...` when enabled.

New business modules must not disable or bypass the global guard.

Do not add decorators, metadata or route-level exceptions that bypass Basic Auth unless a future document explicitly introduces public unauthenticated endpoints.

## 10. What Not to Do

Do not implement:

- OAuth;
- JWT;
- API keys;
- HMAC;
- mTLS;
- roles;
- scopes;
- permissions;
- rate limiting;
- production observability sink;
- user/preferences/evaluation business logic;
- request id generation;
- request id validation.

Do not add bypass for:

```text
/internal/...
```

Do not change OpenAPI if the current `basicAuth` contract already matches the implementation.

Do not log credentials or auth headers.

## 11. Tests

Add unit and/or e2e tests for Basic Auth.

Minimum scenarios:

- request without `Authorization` returns `401`;
- request with non-`Basic` scheme returns `401`;
- request with missing Basic token returns `401`;
- request with invalid Base64 returns `401`;
- request with Base64 without `:` returns `401`;
- request with empty username returns `401`;
- request with empty password returns `401`;
- request with wrong username/password returns `401`;
- request with correct credentials passes to the next handler/controller;
- password containing `:` is parsed correctly;
- auth scheme comparison is case-insensitive;
- every `401` includes `WWW-Authenticate`;
- response body matches `{ error, requestId }`;
- `requestId` comes from observability context;
- raw `Authorization` header does not appear in `error.details`;
- decoded credentials do not appear in `error.details`;
- username/password do not appear in `error.details`;
- missing env credentials return safe `internal_server_error`;
- auth misconfiguration does not expose env names or env values to the client.

Internal endpoint behavior tests, if the user API/internal routing already exists:

- when `ENABLE_INTERNAL_ENDPOINTS=false`, internal endpoint returns `404`;
- disabled internal endpoint does not create/update data;
- when `ENABLE_INTERNAL_ENDPOINTS=true`, internal endpoint still requires Basic Auth.

If internal endpoints are not implemented yet, leave these tests to the User API agent and mention the dependency in the report.

## 12. Verification

Before reporting completion, run:

```bash
pnpm run build
```

If the project has a test script, run:

```bash
pnpm test
```

If the test script is missing, state that explicitly in the final report.

If some tests cannot run because later modules are not implemented yet, run available focused tests and explain the limitation.

## 13. Completion Criteria

The task is complete when:

- `AuthModule` exists;
- `AuthModule` is connected to the root application module;
- Basic Auth is implemented through a NestJS Guard;
- guard is applied globally to all enabled HTTP endpoints;
- credentials are read from config/env, not from hardcoded values;
- missing credentials are handled as safe misconfiguration;
- `Authorization: Basic ...` is parsed according to the documented rules;
- password may contain `:`;
- credentials are compared safely;
- auth failures return `401`;
- every `401` includes `WWW-Authenticate`;
- auth failures use the standard error envelope;
- guard uses `ErrorService`;
- guard consumes observability context;
- guard does not generate `requestId`;
- credentials and auth headers are not logged;
- credentials and auth headers do not appear in `error.details`;
- guard does not contain preferences/evaluation business logic;
- tests cover required auth scenarios;
- build passes.

## 14. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `AuthModule` is connected;
- how the guard is applied globally;
- how credentials are read;
- how credentials are parsed;
- how credentials are compared safely;
- how `WWW-Authenticate` is added;
- how `ErrorService` is used;
- how observability context is consumed;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
