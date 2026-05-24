# Agent 02: Observability Context

## Goal

Implement the early observability context for all HTTP requests.

This stage creates the correlation foundation used by:

- API response envelopes;
- errors module;
- Basic Auth guard;
- controllers;
- services;
- exception filters;
- observability events;
- HTTP telemetry.

The observability context must contain:

- `requestId`;
- `serviceId`;
- optional `correlationId`.

This stage replaces a standalone request-context module. Request correlation is owned by the observability boundary.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/openapi.yaml](../openapi.yaml);
- [docs/observability.md](../observability.md).

## Project Context

The project already has a base NestJS structure:

- [src/app.module.ts](../../src/app.module.ts);
- [src/main.ts](../../src/main.ts);
- [src/config/app.config.ts](../../src/config/app.config.ts).

This stage should introduce the minimal observability context foundation required by later agents.

The full observability sink, domain events, counters and timers may be completed later in:

```text
docs/agents/08-observability.md
```

## Scope

This stage must implement:

- `ObservabilityModule`;
- `ObservabilityMiddleware`;
- context storage;
- context access service;
- request id generation and validation;
- service id configuration;
- correlation id support;
- `X-Request-Id` response header;
- minimal HTTP duration measurement;
- tests for context behavior.

This stage must not implement full domain observability events such as:

- `preference_changed`;
- `quiet_hours_changed`;
- `notification_decision`.

Those events belong to later domain/observability stages.

## Recommended Structure

Recommended files:

```text
src/observability/
  observability.module.ts
  observability.middleware.ts
  observability-context.service.ts
  observability-context.types.ts
  request-id.ts
```

Optional later files may include:

```text
src/observability/
  observability.service.ts
  observability.sink.ts
  stdout-observability.sink.ts
  observability-events.ts
  observability-metrics.ts
```

Do not implement optional later files in this stage unless they are needed for a clean minimal design.

## 1. Observability Module

Add a dedicated NestJS module:

```text
ObservabilityModule
```

The module must provide:

- `ObservabilityMiddleware`;
- `ObservabilityContextService`;
- any helpers needed for request id generation or validation.

The module must be connected to the root application module.

The middleware must run for all HTTP requests.

It must run before guards, controllers and exception filters that need request correlation metadata.

## 2. Observability Middleware

`ObservabilityMiddleware` is responsible for creating the observability context at the beginning of every HTTP request.

The middleware must:

- read `X-Request-Id` from request headers;
- validate the incoming request id;
- generate a new `requestId` if the header is missing or invalid;
- read `X-Correlation-Id` if present and valid;
- read `SERVICE_ID` from configuration;
- use `notification-preferences-service` as the default `serviceId` if `SERVICE_ID` is not provided;
- store `requestId`, `serviceId` and `correlationId` in context storage;
- make the context available to controllers, services, guards and exception filters;
- add `X-Request-Id` to response headers;
- measure HTTP request duration;
- prepare or record minimal HTTP telemetry if a sink/service already exists.

Important rule:

- this middleware owns `requestId` generation;
- errors module, auth guard and domain services must consume the existing context;
- they must not generate their own `requestId`.

## 3. Context Fields

The observability context must contain:

```ts
type ObservabilityContext = {
  requestId: string;
  serviceId: string;
  correlationId: string | null;
};
```

Field semantics:

- `requestId` identifies one HTTP request handled by this service;
- `serviceId` identifies the service or service instance producing telemetry;
- `correlationId` optionally identifies a broader external call chain or message flow.

These fields are correlation metadata only.

They must not be used for domain decisions.

## 4. Request ID

The middleware must read:

```text
X-Request-Id
```

Rules:

- if the header is present and valid, reuse it;
- if the header is missing, generate a new `requestId`;
- if the header is invalid, ignore it and generate a new `requestId`;
- do not return a validation error for invalid `X-Request-Id`;
- the same `requestId` must be used throughout the request lifecycle;
- the final `requestId` must be returned in the response header `X-Request-Id`;
- success envelopes must use this `requestId`;
- error envelopes must use this `requestId`;
- observability events must use this `requestId`.

### Request ID Format

Generated request ids should use this format:

```text
req_<unix_epoch_ns>_<random_suffix>
```

Example:

```text
req_1779604200123456789_a3f91c
```

Generation rules:

- the timestamp part should be based on current Unix time;
- the timestamp should be monotonic enough within the process to avoid duplicates under concurrent requests;
- add a short random suffix to reduce collision risk across multiple service instances;
- do not include `serviceId`, hostname, pod name, user id, IP address or other sensitive/infrastructure-identifying data.

In Node.js, it is acceptable to use `Date.now()` together with `process.hrtime.bigint()` or another monotonic source.

If exact epoch nanoseconds are not reliable, epoch milliseconds plus a monotonic nano-offset and random suffix are acceptable, while preserving the format:

```text
req_<time_ns>_<random_suffix>
```

### Incoming Request ID Validation

Incoming `X-Request-Id` is valid only if it is:

- a string;
- length `8..128`;
- contains only:
  - Latin letters;
  - digits;
  - `_`;
  - `-`;
  - `.`;
  - `:`.

If invalid, replace it with a generated value.

Do not log the full request headers.

## 5. Service ID

`serviceId` must come from configuration/environment:

```text
SERVICE_ID
```

Default value:

```text
notification-preferences-service
```

If the project already has application config in:

```text
src/config/app.config.ts
```

extend it with:

```ts
serviceId: string;
```

Do not read `process.env` directly inside business modules.

`serviceId` must be available through `ObservabilityContextService`.

Outside an HTTP request context, `getServiceId()` must still return the configured value or the default.

## 6. Correlation ID

The middleware may read:

```text
X-Correlation-Id
```

Rules:

- if the header is missing, `correlationId` must be `null`;
- if the header is present and valid, store it in the observability context;
- if the header is present but invalid, ignore it and use `null`;
- do not return a validation error for invalid `X-Correlation-Id`;
- do not include `correlationId` in API response envelopes unless OpenAPI explicitly defines it.

Use the same validation rules as `X-Request-Id` unless [docs/observability.md](../observability.md) defines a stricter format.

## 7. Context Storage

The local context storage mechanism is an implementation detail.

Acceptable options:

- `AsyncLocalStorage`;
- request-scoped provider;
- middleware attaching context to the request object.

Preferred approach:

```text
AsyncLocalStorage
```

because guards, services and exception filters can read the same context without passing the request object manually.

The selected mechanism must make context available to:

- controllers;
- services;
- guards;
- interceptors;
- exception filters;
- later observability services.

Important limitation:

Local in-process context does not solve distributed tracing across pods or services.

For cross-service correlation, outgoing clients must explicitly propagate:

- `X-Request-Id`;
- `X-Correlation-Id`.

This task only needs to prepare context access so future HTTP clients or message publishers can read these values.

## 8. ObservabilityContextService

Add a service for reading the current context.

Minimum methods:

```ts
getRequestId(): string | null;
getServiceId(): string;
getCorrelationId(): string | null;
getContext(): ObservabilityContext | null;
```

Expected behavior inside HTTP request context:

- `getRequestId()` returns the current request id;
- `getServiceId()` returns the configured/default service id;
- `getCorrelationId()` returns the current correlation id or `null`;
- `getContext()` returns the full context.

Expected behavior outside HTTP request context:

- `getRequestId()` returns `null`;
- `getCorrelationId()` returns `null`;
- `getServiceId()` returns configured/default service id;
- `getContext()` returns `null`.

This is important for:

- seed scripts;
- future background jobs;
- future message consumers;
- tests executed outside HTTP context.

## 9. Response Header

Every HTTP response must include:

```text
X-Request-Id: <requestId>
```

This must apply to both:

- successful responses;
- error responses.

If possible, set the header as early as possible in the middleware.

If an exception is thrown later, the same `X-Request-Id` must still be visible in the response.

## 10. Minimal HTTP Telemetry

This stage may prepare or record minimal HTTP telemetry.

At minimum, the middleware should measure request duration.

If a minimal logger/sink already exists, the middleware may record technical HTTP events such as:

- `http_request_started`;
- `http_request_completed`;
- `http_request_failed`.

If the sink is not implemented yet, store the duration measurement logic and leave the actual event sink to:

```text
docs/agents/08-observability.md
```

Telemetry must not block or break request handling.

Telemetry errors must be swallowed or sent to a safe fallback logger.

Do not implement domain events in this stage.

## 11. Security and Privacy

The middleware must not log sensitive data.

Do not log:

- all request headers;
- `Authorization` header;
- cookies;
- Basic Auth credentials;
- decoded credentials;
- raw request body;
- query strings if they may contain sensitive data;
- connection strings;
- environment variable values.

Request id and correlation id validation must not expose rejected values in public errors.

The generated request id must not contain:

- hostname;
- pod name;
- service id;
- user id;
- IP address;
- region;
- tenant;
- any business identifier.

## 12. What Not to Do

Do not implement:

- errors module;
- Basic Auth guard;
- preferences domain logic;
- evaluation domain logic;
- user API;
- PostgreSQL schema changes;
- full observability sink;
- production OpenTelemetry/Prometheus/ClickHouse integration;
- domain observability events;
- success/error response envelope builders.

Do not change OpenAPI unless the current API contract becomes inconsistent with request correlation behavior.

Do not create a separate `RequestContextModule` unless the project maintainers explicitly choose to split it from observability.

## 13. Tests

Add unit and/or e2e tests for observability context behavior.

Minimum scenarios:

- request without `X-Request-Id` receives generated `requestId`;
- generated `requestId` is returned in response header `X-Request-Id`;
- request with valid `X-Request-Id` reuses the provided value;
- request with invalid `X-Request-Id` receives a new generated value;
- invalid `X-Request-Id` does not return a validation error;
- `ObservabilityContextService.getRequestId()` returns request id inside request handling;
- `serviceId` is read from `SERVICE_ID`;
- if `SERVICE_ID` is missing, `notification-preferences-service` is used;
- valid `X-Correlation-Id` is stored in context;
- invalid `X-Correlation-Id` is ignored;
- `correlationId` is not returned in the response envelope unless OpenAPI defines it;
- outside HTTP request context, service returns safe fallback values;
- `X-Request-Id` is present in responses when downstream handler throws an error, if test infrastructure allows this at this stage.

Do not add tests that require the errors module or Basic Auth guard unless they already exist.

## 14. Verification

Before reporting completion, run:

```bash
pnpm run build
```

If the project has a test script, run:

```bash
pnpm test
```

If there is no test script, do not add one unless it is already part of project conventions or this does not expand the task scope too much.

Clearly state which checks were executed.

If some checks could not be executed, state the exact reason.

## 15. Completion Criteria

The task is complete when:

- `ObservabilityModule` exists;
- `ObservabilityMiddleware` exists;
- middleware is applied globally to all HTTP requests;
- observability context is created at the beginning of each HTTP request;
- valid `X-Request-Id` is reused;
- invalid or missing `X-Request-Id` is replaced with a generated `requestId`;
- generated `requestId` follows the documented format;
- `X-Request-Id` is added to every response;
- `serviceId` is available and has a default;
- optional `correlationId` is supported;
- context is available to controllers/services/guards/filters;
- `ObservabilityContextService` exposes required methods;
- errors module is not required for this stage to work;
- Basic Auth guard is not implemented in this stage;
- domain model and API controllers are not changed;
- production observability sinks are not implemented in this stage;
- tests cover the required context behavior;
- build passes.

## 16. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `ObservabilityModule` is connected;
- how `ObservabilityMiddleware` is applied;
- how context storage is implemented;
- how `requestId` is validated and generated;
- how `serviceId` is configured;
- how `correlationId` is handled;
- how `X-Request-Id` is returned;
- whether HTTP duration measurement was added;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
