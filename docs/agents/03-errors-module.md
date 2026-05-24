# Agent 03: Errors Module

## Goal

Implement a shared NestJS errors module that converts all HTTP errors into the standard OpenAPI error envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "details": {}
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

This stage is responsible for:

- the common application error model;
- `ErrorService`;
- global exception filter;
- validation error mapping;
- base infrastructure errors;
- integration point for future structured error observability events.

Domain modules will define and throw their own module-specific errors through `ErrorService`.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/openapi.yaml](../openapi.yaml);
- [docs/observability.md](../observability.md).

## Dependencies from Previous Stages

This stage depends on the result of Agent 02: Observability Context.

Expected existing behavior:

- `requestId` is created by `ObservabilityMiddleware`;
- `serviceId` is available through observability context;
- optional `correlationId` is available through observability context;
- `X-Request-Id` is added to HTTP responses;
- downstream modules can read context through `ObservabilityContextService`.

The errors module must consume the existing observability context.

The errors module must not generate its own `requestId`.

If observability context is not implemented yet, this agent must leave an explicit integration point and must not invent a second request id generation mechanism.

## Scope

This stage may implement:

- errors module;
- application error type;
- error codes;
- error response types;
- error service;
- global exception filter;
- validation exception factory/helper;
- safe details sanitization;
- structured error event integration point.

This stage must not implement:

- Basic Auth guard;
- user API;
- preferences API;
- evaluation API;
- observability sink;
- production OpenTelemetry/Prometheus/ClickHouse integration;
- business logic for user/preferences/evaluation modules.

## Recommended Structure

Recommended files:

```text
src/errors/
  errors.module.ts
  application-error.ts
  error-codes.ts
  error-response.types.ts
  error.service.ts
  global-exception.filter.ts
  validation-exception.factory.ts
  error-details-sanitizer.ts
```

`error-details-sanitizer.ts` may be omitted if sanitization is implemented cleanly elsewhere.

## 1. Errors Module

Add a dedicated NestJS module:

```text
ErrorsModule
```

The module must be connected to the root application module:

```text
src/app.module.ts
```

The global exception filter must be registered through a provider inside `ErrorsModule`, for example via `APP_FILTER`.

Do not register the filter manually in `main.ts` unless the project structure clearly requires it. If manual registration is used, explain the reason in the final report.

## 2. ApplicationError

Implement a base `ApplicationError`.

Minimum fields:

```ts
code: string;
message: string;
httpStatus: number;
details?: Record<string, unknown> | null;
```

Additional fields useful for observability:

```ts
component?: string;
operation?: string;
severity?: 'info' | 'warning' | 'error' | 'critical';
retryable?: boolean;
cause?: unknown;
```

Rules:

- `code`, `message`, `httpStatus` define public error behavior;
- `details` may be public only after sanitization;
- `component`, `operation`, `severity`, `retryable` are observability metadata;
- observability metadata must not automatically appear in the public response body;
- `cause` must never be exposed in the public response body.

## 3. ErrorService

Add `ErrorService` as the single way to create typed `ApplicationError` instances.

Expected usage in domain/auth modules:

```ts
throw errorService.notFound({
  message: 'User was not found.',
  details: { ecosystemCode, userId },
  component: 'users',
  operation: 'get_user_preferences',
});
```

Expected usage for infrastructure errors:

```ts
throw errorService.validation({
  message: 'Request validation failed.',
  details: { fields },
});

throw errorService.internal({
  message: 'Internal server error.',
});
```

Minimum methods:

```ts
validation(input): ApplicationError;
badRequest(input): ApplicationError;
unauthorized(input): ApplicationError;
notFound(input): ApplicationError;
conflict(input): ApplicationError;
internal(input): ApplicationError;
serviceUnavailable(input): ApplicationError;
```

Required method behavior:

| Method | Error code | HTTP status | Intended usage |
| --- | --- | --- | --- |
| `validation` | `validation_error` | `400` | DTO/class-validator errors, invalid request shape, extra fields, invalid enum-like values. |
| `badRequest` | `bad_request` | `400` | Domain validation after DTO validation, invalid IANA timezone, `quiet_hours.start_time = quiet_hours.end_time`, invalid datetime semantics. |
| `unauthorized` | `unauthorized` | `401` | Missing/invalid Basic Auth credentials. |
| `notFound` | `not_found` | `404` | Missing user, notification type, channel or disabled internal endpoint. |
| `conflict` | `conflict` | `409` | State conflict or uniqueness conflict that cannot be resolved by idempotent upsert. |
| `internal` | `internal_server_error` | `500` | Unexpected application error. |
| `serviceUnavailable` | `service_unavailable` | `503` | PostgreSQL or required dependency unavailable. |

HTTP status must be determined by `ErrorService` methods.

Domain modules must not pass raw HTTP status manually on every call.

Base input type:

```ts
type ErrorInput = {
  message?: string;
  details?: Record<string, unknown> | null;
  component?: string;
  operation?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  retryable?: boolean;
  cause?: unknown;
};
```

Do not add methods that are not required for the MVP without a clear reason.

For example, do not add:

```ts
forbidden(input): ApplicationError;
```

unless the API/security contract introduces a real `403 Forbidden` scenario.

The errors module provides common HTTP mapping. It must not contain business rules for users, preferences or evaluation.

## 4. Error Codes

Add base error codes required by the MVP infrastructure:

```ts
validation_error
bad_request
unauthorized
not_found
conflict
internal_server_error
service_unavailable
```

The errors module may expose these as constants or a TypeScript enum-like object.

Important distinction:

- API error codes are not evaluation decision reasons.
- Missing entities must be returned as API errors, not successful `deny` decisions.

Examples:

- unknown user → `404 not_found`;
- unknown notification type → `404 not_found`;
- unknown channel → `404 not_found`.

Do not encode missing entities as successful evaluation reasons such as `user_not_found`.

## 5. Global Exception Filter

Implement a global exception filter.

Mapping rules:

- `ApplicationError` must be returned with its `httpStatus`, `code`, `message` and sanitized `details`;
- NestJS validation errors must map to `validation_error`;
- unexpected exceptions must map to `internal_server_error`;
- unexpected exceptions must use HTTP `500`;
- unexpected exception public message must be safe, for example `Internal server error.`;
- public response must never expose stack trace, raw SQL errors, raw exception messages, env values, headers or credentials.

Strict public response format:

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

`requestId` rules:

- read from `ObservabilityContextService`;
- if no HTTP observability context exists, return `null`;
- never generate a new request id inside the errors module.

`serviceId` and `correlationId` may be used for internal observability event metadata, but must not appear in the public error envelope unless OpenAPI explicitly defines them.

## 6. Validation Pipe Integration

Prepare a factory/helper for NestJS `ValidationPipe` so validation errors become `ApplicationError` with code:

```text
validation_error
```

The validation integration must support strict DTO validation:

- whitelist known fields;
- reject unknown fields;
- reject invalid nested fields;
- return stable field paths.

Recommended validation details shape:

```json
{
  "fields": [
    {
      "path": "preferences.0.channel",
      "messages": ["channel must be one of: email, sms, push, messenger"]
    }
  ]
}
```

Rules for validation details:

- include only safe field paths and validation messages;
- do not include the original request body;
- do not include headers;
- do not include credentials;
- do not include raw internal exceptions;
- keep the structure stable for tests.

## 7. Details Sanitization

All `error.details` must be sanitized before being returned to the client.

Allowed details:

- safe identifiers explicitly needed for debugging, such as:
  - `ecosystemCode`;
  - `userId`;
  - `notificationType`;
  - `channel`;
  - `region`;
  - validation field paths;
- non-sensitive metadata such as operation input names, not raw payloads.

Forbidden details:

- `Authorization` header;
- cookies;
- Basic Auth username/password;
- decoded credentials;
- environment variable values;
- connection strings;
- raw SQL errors;
- raw request body;
- full request headers;
- stack traces;
- access tokens;
- refresh tokens;
- API keys;
- private keys;
- secrets;
- raw exception objects.

If details contain unsupported values, the sanitizer must remove or replace them with a safe value.

For unexpected exceptions, public `details` should normally be:

```json
null
```

## 8. Observability Integration Point

Prepare an integration point for future structured error events.

This stage does not need to implement the full observability sink.

The global exception filter should be structured so that a later observability service can record a `service_error` event with:

- `requestId`;
- `serviceId`;
- `correlationId`;
- `errorCode`;
- `component`;
- `operation`;
- `severity`;
- `retryable`;
- safe metadata.

For auth failures, later integration may record:

```text
component = auth
operation = basic_auth
severity = warning
```

For auth misconfiguration, later integration may record:

```text
component = auth
operation = basic_auth
severity = critical
```

For unexpected errors, later integration may record:

```text
component = api
operation = handle_request
severity = error
```

Rules:

- error event recording must never block the HTTP response;
- if future observability recording fails, it must not change the API response;
- public API responses must not expose internal observability metadata unless OpenAPI defines it.

Stack trace is allowed only in internal observability events for unexpected errors and only after checking that it does not expose secrets.

Stack trace must never be returned in the HTTP response.

## 9. Interaction with Observability Context

The errors module must depend on `ObservabilityContextService`.

Expected behavior:

- successful request context exists → use its `requestId`;
- error request context exists → use its `requestId`;
- no request context exists → use `requestId: null`.

The errors module must not:

- read `X-Request-Id` directly from headers;
- validate `X-Request-Id`;
- generate `requestId`;
- create a second context system;
- mutate observability context.

If `ObservabilityContextService` is unavailable because Agent 02 is not implemented yet, leave an explicit TODO/integration point and report it.

Do not silently implement a separate request context.

## 10. What Not to Do

Do not implement:

- observability context middleware;
- Basic Auth guard;
- user API;
- preferences API;
- evaluation API;
- domain-specific business errors beyond what is needed to support generic `ErrorService`;
- production observability sink such as ClickHouse, OpenTelemetry, Prometheus or broker integration;
- request id generation;
- request id validation;
- success response envelope builders.

Do not change business rules.

Do not change OpenAPI unless the existing error contract is inconsistent with the required behavior. If OpenAPI changes are needed, report them explicitly.

## 11. Tests

Add unit and/or e2e tests for error handling.

Minimum scenarios:

- `ApplicationError` returns `{ error, requestId }`;
- `requestId` is read from observability context;
- if observability context is absent, `requestId` is `null`;
- `validation` error returns HTTP `400` and code `validation_error`;
- `badRequest` error returns HTTP `400` and code `bad_request`;
- `unauthorized` error returns HTTP `401` and code `unauthorized`;
- `notFound` error returns HTTP `404` and code `not_found`;
- `conflict` error returns HTTP `409` and code `conflict`;
- `internal` error returns HTTP `500` and code `internal_server_error`;
- `serviceUnavailable` error returns HTTP `503` and code `service_unavailable`;
- unexpected exception returns HTTP `500` and code `internal_server_error`;
- unexpected exception does not expose raw exception message;
- unexpected exception does not expose stack trace;
- validation details contain safe field paths;
- validation details do not contain full request body;
- sanitized details do not contain credentials, headers, connection strings or raw SQL errors;
- global exception filter does not generate a new `requestId`.

If e2e tests require modules that do not exist yet, use focused unit tests or a minimal test controller/module.

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

- `ErrorsModule` exists;
- `ErrorsModule` is connected to the root application module;
- global exception filter is registered through `ErrorsModule`;
- base typed `ApplicationError` exists;
- `ErrorService` exists;
- `ErrorService` exposes required factory methods;
- common error codes are implemented;
- all HTTP errors can be converted to OpenAPI envelope `{ error, requestId }`;
- `requestId` is read from observability context;
- errors module does not generate `requestId`;
- validation errors map to `validation_error`;
- unexpected exceptions map to `internal_server_error`;
- unexpected exceptions do not expose internal details;
- details sanitization exists;
- controllers and services do not need to build error responses manually;
- integration point for future structured error events exists;
- errors module does not contain user/preferences/evaluation business logic;
- tests cover required error scenarios;
- build passes.

## 14. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `ErrorsModule` is connected;
- how the global exception filter is registered;
- which base errors were added;
- which `ErrorService` methods were implemented;
- how validation errors are mapped;
- how `requestId` is read from observability context;
- how details sanitization works;
- what observability integration point was prepared;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
