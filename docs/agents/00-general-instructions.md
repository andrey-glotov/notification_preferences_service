# Agent Task: General Instructions

## Purpose

This document defines the general rules for all AI agents implementing the Notification Preferences Service.

Every subsequent agent task must follow these rules regardless of its specific scope.

## Project Context

Notification Preferences Service is a centralized service for managing user notification preferences.

The service is the source of truth for other product modules and answers the question:

```text
Can this notification be sent to this user through this channel at this specific time?
```

The decision must consider:

- default notification preferences;
- user-specific preferences;
- global policies;
- quiet hours;
- the user's timezone;
- idempotent preference updates.

## Technology Stack

Primary stack:

- TypeScript;
- Node.js;
- NestJS;
- PostgreSQL;
- Drizzle ORM.

Additional project components:

- OpenAPI for HTTP API contract documentation;
- structured logging / observability module;
- Docker Compose for local development.

ClickHouse, Prometheus, OpenTelemetry, a message broker, or an external observability platform are not mandatory for the MVP.

The MVP must provide a lightweight observability module with a stdout or application logger sink.

## Source of Truth

Before starting any implementation task, the agent must read the relevant documents:

- `docs/business-logic.md` — business rules and PostgreSQL model;
- `docs/openapi.yaml` — HTTP API contract;
- `docs/observability.md` — logging, metrics, request correlation and observability requirements;
- `docs/security-notes.md` — security constraints and Basic Auth requirements;
- `docs/agents/implementation-plan.md` — overall implementation order.

If there is a conflict between documents, use the following priority order:

1. `docs/openapi.yaml` is the source of truth for the HTTP API contract.
2. `docs/business-logic.md` is the source of truth for business rules.
3. `docs/security-notes.md` is the source of truth for security behavior.
4. `docs/observability.md` is the source of truth for observability, telemetry and request correlation behavior.

If a conflict cannot be resolved locally, the agent must stop and explicitly report the inconsistency.

## General Implementation Rules

The agent must:

- use TypeScript for all backend code;
- follow NestJS module structure;
- separate domain logic from infrastructure;
- keep controllers thin;
- avoid business logic in controllers;
- avoid persistence queries in controllers;
- avoid mixing persistence models and domain logic unless there is a clear reason;
- use Drizzle schema and migrations for PostgreSQL;
- preserve idempotency for all preference-changing operations;
- add tests for newly introduced business logic;
- keep OpenAPI in sync with API behavior;
- keep business documentation in sync with business rule changes;
- keep security documentation in sync with security behavior changes;
- keep observability documentation in sync with observability behavior changes;
- avoid unnecessary infrastructure dependencies;
- avoid production-grade infrastructure that is outside MVP scope unless explicitly requested;
- avoid logging sensitive data.

The agent must not:

- change the HTTP API without updating `docs/openapi.yaml`;
- change business rules without updating `docs/business-logic.md`;
- change security behavior without updating `docs/security-notes.md`;
- bypass Basic Auth for enabled endpoints;
- create users automatically inside preferences or evaluation logic;
- create notification types, channels, default preferences or global policies on the fly;
- log secrets, credentials, raw headers, connection strings or raw SQL errors;
- return stack traces or raw internal errors in public API responses.

## API Contract

All HTTP endpoints must follow `docs/openapi.yaml`.

Successful responses must use the envelope:

```json
{
  "data": {},
  "requestId": "req_1779604200123456789_a3f91c"
}
```

Error responses must use the envelope:

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

`requestId` must come from the observability context created at the beginning of the HTTP request.

Controllers and services must not manually build error responses. Errors must go through the shared errors module.

## Strict Request Validation

All request DTOs must reject unknown fields unless the OpenAPI contract explicitly allows them.

Use strict validation for:

- path params;
- query params;
- request bodies;
- nested request objects.

Requests with extra fields must return `400 validation_error`.

The validation error response may include a safe list of invalid or unexpected field paths, but must not return the original request body as-is.

## Decision Reasons vs Error Codes

Business decision reasons and API error codes must be kept separate.

A successful evaluation response may return only business decision reasons such as:

- `allowed_by_user_preference`;
- `blocked_by_user_preference`;
- `allowed_by_default_preference`;
- `blocked_by_default_preference`;
- `blocked_by_global_policy`;
- `blocked_by_quiet_hours`;
- `fallback_deny`.

Missing entities must not be returned as successful evaluation decisions.

The following cases must be API errors, not `deny` decisions:

- unknown user;
- unknown notification type;
- unknown channel.

Examples:

- unknown user → `404` error response;
- unknown notification type → `404` error response;
- unknown channel → `404` error response.

Do not return a successful response like:

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

## Observability Context

The service must create an observability context at the beginning of every HTTP request.

The observability context contains:

- `requestId`;
- `serviceId`;
- optional `correlationId`.

The `ObservabilityMiddleware` is responsible for creating and storing this context.

The middleware must:

- read `X-Request-Id` from request headers;
- validate the incoming request id;
- generate a new `requestId` if the header is missing or invalid;
- read `X-Correlation-Id` if present and valid;
- read `SERVICE_ID` from configuration;
- use `notification-preferences-service` as default `serviceId` if `SERVICE_ID` is not provided;
- store `requestId`, `serviceId` and `correlationId` in a context accessible to controllers, services, guards, interceptors and exception filters;
- add `X-Request-Id` to the response headers;
- measure HTTP request duration;
- prepare or record HTTP-level telemetry.

The middleware must run before guards, controllers and exception filters that need request correlation metadata.

The errors module, auth guard and domain services must consume the existing observability context. They must not generate their own `requestId`.

`requestId`, `serviceId` and `correlationId` are correlation metadata only. They must not be used for business decisions.

## Observability Middleware Scope

`ObservabilityMiddleware` may record technical HTTP telemetry, such as:

- `http_request_started`;
- `http_request_completed`;
- `http_request_failed`;
- `http_requests_total`;
- `http_request_duration_ms`;
- `http_requests_failed_total`.

HTTP telemetry may include safe metadata:

- HTTP method;
- normalized route pattern;
- status code;
- duration in milliseconds;
- `requestId`;
- `serviceId`;
- `correlationId`.

The middleware must not record sensitive data.

Do not record:

- raw request headers;
- `Authorization` header;
- cookies;
- Basic Auth credentials;
- decoded credentials;
- raw request body;
- connection strings;
- raw SQL errors.

Domain-level events must not be inferred in middleware.

The following events must be recorded from the corresponding domain services instead:

- `preference_changed`;
- `quiet_hours_changed`;
- `notification_decision`.

Auth-specific events must be recorded from the auth guard or through the errors/observability integration point.

Service error events must be recorded from the global exception filter or through the errors/observability integration point.

## Security

For the MVP, all enabled HTTP endpoints must require Basic Auth.

Basic Auth must be implemented through a NestJS Guard.

Credentials must come from configuration/environment variables:

```text
BASIC_AUTH_USERNAME
BASIC_AUTH_PASSWORD
```

The service must not hardcode credentials in code, fixtures, documentation or README examples.

The client must send credentials in the HTTP header:

```text
Authorization: Basic base64(username:password)
```

The guard must:

- parse the `Authorization` header;
- compare the auth scheme case-insensitively;
- require the `Basic` scheme;
- require a valid Base64 token;
- decode credentials safely;
- split decoded credentials by the first `:`;
- allow `:` inside the password;
- reject empty username;
- reject empty password;
- compare username and password using constant-time comparison;
- avoid exposing whether username or password was incorrect;
- return the same public error for all authentication failures.

Unauthorized responses must return:

```text
401 Unauthorized
```

and must include:

```text
WWW-Authenticate: Basic realm="Notification Preferences Service"
```

Public unauthorized response body:

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

Basic Auth is an MVP compromise. Outside local development, Basic Auth must be used only over HTTPS.

## Internal Endpoints

Internal endpoints are intended only for local development, tests and controlled operational use.

Internal endpoints must be controlled by an environment flag:

```text
ENABLE_INTERNAL_ENDPOINTS=true
```

Default value:

```text
false
```

If internal endpoints are disabled:

- the service must return `404 Not Found`;
- the service must not create or update data;
- the public response must not reveal that an internal endpoint exists but is disabled.

Important security rule:

Disabled internal endpoints are treated as unavailable routes and should be hidden before business logic is executed.

For enabled internal endpoints:

- Basic Auth is still required;
- no local bypass is allowed;
- the same error envelope and observability context rules apply.

If the implementation uses a global Basic Auth guard, the agent must ensure that disabled internal endpoints still behave according to the documented security model. If the framework order makes this impossible without additional routing or middleware, the agent must explicitly report the issue instead of silently changing the expected behavior.

## Error Handling

All errors must go through a dedicated NestJS errors module.

The errors module is responsible for:

- base `ApplicationError`;
- `ErrorService`;
- global exception filter;
- validation exception factory;
- common infrastructure error codes;
- unified error envelope.

Domain modules are responsible for throwing meaningful domain errors through `ErrorService`.

Expected error categories:

- `validation_error`;
- `bad_request`;
- `unauthorized`;
- `not_found`;
- `conflict`;
- `internal_server_error`;
- `service_unavailable`.

`error.details` may contain only safe diagnostic context.

The API must never expose:

- stack traces;
- raw SQL errors;
- raw exception messages from unexpected errors;
- secrets;
- headers containing credentials;
- decoded Basic Auth credentials;
- environment variable values;
- connection strings.

The global exception filter must read `requestId` from the observability context and must not generate a new one.

If an error happens outside an HTTP request context, `requestId` may be `null`.

## Business Rules

The agent must preserve these business invariants:

- default preferences are defined by a singleton `default_preferences` set;
- user preferences override default preferences;
- global deny policies have the highest priority during evaluation;
- quiet hours apply only to notification types with `respects_quiet_hours = true`;
- if no user preference exists, the default preference is used;
- if neither user preference nor default preference exists, the result must be `deny`;
- changing `user_preferences` must be idempotent;
- changing `quiet_hours` must be idempotent;
- creating or updating an internal user projection must be idempotent;
- evaluation must not mutate users, preferences, quiet hours, default preferences or global policies.

## Global Policies

The MVP evaluation algorithm uses matching global `deny` policies.

The schema may support both:

```text
allow
deny
```

However, global `allow` policies are reserved for future compatibility and must not change the MVP evaluation order unless the business logic document and OpenAPI contract are explicitly updated.

The MVP evaluation order is:

1. matching global deny policy;
2. quiet hours, only if the notification type respects quiet hours;
3. user preference;
4. default preference;
5. fallback deny.

## Datetime and Timezone Rules

Evaluation requests must provide `datetime` as a concrete instant with timezone offset.

Valid examples:

```text
2027-05-21T21:30:00Z
2027-05-21T21:30:00+03:00
```

Invalid examples:

```text
2027-05-21T21:30:00
2027-05-21
not-a-date
```

The service must reject:

- invalid datetime strings;
- local or naive datetime strings without timezone offset;
- datetimes in the past relative to the service clock.

Tests must generate future datetimes dynamically instead of relying on fixed dates that may become outdated.

Quiet hours must be evaluated by converting the input instant to the user's configured IANA timezone and comparing only the local time.

Quiet hours rules:

- `startTime < endTime` means same-day interval;
- `startTime > endTime` means interval crossing midnight;
- `startTime = endTime` must be rejected.

## PostgreSQL and Data Integrity

The PostgreSQL schema must enforce core integrity rules.

All MVP tables must use UUID primary keys and timestamps.

Required MVP tables:

- `users`;
- `notification_types`;
- `channels`;
- `default_preferences`;
- `user_preferences`;
- `quiet_hours`;
- `global_policies`.

The service must use local internal `users.id` for relations.

External user identity must be stored as:

```text
ecosystem_code + external_user_id
```

This prevents collisions between ecosystems or tenants.

User-facing `userId` in the API maps to `users.external_user_id`.

## Transactions and Atomicity

Operations that update multiple pieces of state in a single request must be atomic.

For example, if a preferences update request contains both:

- `preferences`;
- `quietHours`;

then the update must be performed in a single transaction.

The service must not leave the database in a partially updated state if one part of the operation fails.

## Observability Events and Metrics

The MVP must log key events:

- preference changes;
- quiet hours changes;
- notification evaluation decisions;
- service errors;
- authentication failures.

The MVP must provide structure for:

- counters;
- timers;
- structured events.

Default MVP sink:

```text
stdout / application logger
```

Observability must not be a source of truth.

Rules:

- observability sink failure must not roll back PostgreSQL operations;
- observability sink failure must not break API responses;
- no retry loop may delay user requests;
- fallback logging may be used if the sink fails.

All observability events created within an HTTP request must include:

- `requestId`;
- `serviceId`;
- `correlationId`, if available.

Sensitive data must not be written to logs, metrics labels or observability output.

Do not log:

- `Authorization` header;
- Basic Auth username/password;
- decoded credentials;
- environment variable values;
- connection strings;
- raw SQL errors;
- full request payloads that may contain sensitive data.

User identifiers may be logged for MVP debugging, but production sinks may require hashing, pseudonymization or stricter data handling.

## Testing

Each task must add tests proportionally to the change.

Required business scenarios that must be covered by the final solution:

- default preferences for a new user;
- user preference update;
- user preferences overriding default preferences;
- quiet hours blocking non-critical notifications;
- transactional or security notifications remaining allowed during quiet hours if they do not respect quiet hours;
- global deny policy;
- global deny policy taking priority over user/default preferences;
- idempotent repeated preference update;
- idempotent repeated quiet-hours update;
- fallback deny when neither user nor default preference exists.

Infrastructure scenarios that must be covered:

- observability context middleware;
- request id generation and propagation;
- `X-Request-Id` response header;
- error envelope;
- validation errors;
- Basic Auth guard;
- disabled internal endpoint behavior;
- API validation;
- extra fields rejection;
- invalid datetime;
- past datetime;
- unknown user;
- unknown notification type;
- unknown channel.

## README and Operations

The final solution must include a README with:

- how to start the service;
- how to start PostgreSQL;
- how to apply migrations;
- how to seed base data;
- how to seed test data;
- how to run tests;
- available endpoints;
- how to use Basic Auth;
- how observability works in MVP;
- known MVP limitations;
- what should be improved for production.

## Definition of Done for Any Agent Task

A task is complete only if:

- the implementation matches its agent task;
- source-of-truth documents are not violated;
- OpenAPI is updated if the HTTP contract changes;
- business documentation is updated if business rules change;
- security documentation is updated if security behavior changes;
- observability documentation is updated if request correlation, logging, metrics or telemetry behavior changes;
- relevant tests are added or updated;
- the code builds;
- existing behavior is not broken;
- the final report explicitly lists what was changed;
- the final report explicitly lists which checks were executed;
- the final report explicitly lists anything that could not be verified.
