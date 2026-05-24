# AI Agent Implementation Plan

This document defines the order for preparing task instructions for AI agents that will implement the Notification Preferences Service.

The main idea is to avoid giving one agent a large and ambiguous prompt. Instead, the implementation is split into short task documents with clear ownership, input artifacts, expected output and completion criteria.

## 1. General Instructions for All Agents

File: [docs/agents/00-general-instructions.md](00-general-instructions.md)

Contains:

- technology stack:
  - TypeScript;
  - NestJS;
  - Drizzle ORM;
  - PostgreSQL;
  - structured logging / observability module;
- source-of-truth documents:
  - [docs/business-logic.md](../business-logic.md);
  - [docs/observability.md](../observability.md);
  - [docs/security-notes.md](../security-notes.md);
  - [docs/openapi.yaml](../openapi.yaml);
- common implementation rules:
  - do not change the API without updating OpenAPI;
  - do not change business rules without updating [docs/business-logic.md](../business-logic.md);
  - do not change security behavior without updating [docs/security-notes.md](../security-notes.md);
  - do not change observability/request-correlation behavior without updating [docs/observability.md](../observability.md);
  - add tests for business logic;
  - preserve idempotency;
  - protect all enabled HTTP endpoints with Basic Auth;
  - implement Basic Auth through a NestJS Guard;
  - make all API responses follow the OpenAPI envelope;
  - route all errors through a dedicated NestJS errors module;
  - create `requestId`, `serviceId` and optional `correlationId` through observability context;
  - do not log credentials, raw headers, connection strings, raw SQL errors or sensitive payloads.

## 2. PostgreSQL Schema Agent

File: [docs/agents/01-postgres-schema.md](01-postgres-schema.md)

Task:

- implement the Drizzle schema;
- create migrations;
- add base seed data for:
  - `notification_types`;
  - `channels`;
  - `default_preferences`;
- add test/development seed data for `global_policies`, for example:
  - deny `marketing + sms + EU`;
- verify:
  - `drizzle:generate`;
  - `drizzle:migrate`;
  - base seed;
  - test seed, if available.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml).

Expected result:

- PostgreSQL schema matches the business document;
- migrations can be applied to a clean database;
- dictionaries and default preferences can be seeded;
- test global policies can be seeded separately from production/base seed;
- seed operations are idempotent;
- schema changes do not touch API, auth, errors, observability or domain services.

## 3. Observability Context Agent

File: [docs/agents/02-observability-context.md](02-observability-context.md)

Task:

- implement early request correlation through `ObservabilityMiddleware`;
- read `X-Request-Id` if the client provides it;
- validate the incoming `X-Request-Id`;
- generate a new `requestId` if the header is missing or invalid;
- read `X-Correlation-Id` if present and valid;
- read `SERVICE_ID` from configuration;
- use `notification-preferences-service` as the default `serviceId`;
- store `requestId`, `serviceId` and `correlationId` in a context accessible to:
  - controllers;
  - services;
  - guards;
  - interceptors;
  - exception filters;
  - observability services;
- add `X-Request-Id` to response headers;
- measure HTTP request duration;
- prepare HTTP-level telemetry;
- add tests for middleware/context behavior.

Important ownership rule:

- `ObservabilityMiddleware` owns request correlation.
- Errors module, auth guard and domain services must consume the existing observability context.
- They must not generate their own `requestId`.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/openapi.yaml](../openapi.yaml);
- [docs/observability.md](../observability.md).

Expected result:

- `requestId` is created once per incoming HTTP request;
- valid incoming `X-Request-Id` is reused;
- invalid incoming `X-Request-Id` is replaced with a generated one;
- `requestId` is available during request handling;
- `serviceId` is available during request handling;
- optional `correlationId` is available when valid;
- success and error envelopes can use the same `requestId`;
- errors module will use the existing `requestId` and will not generate a new one;
- observability events can use `requestId`, `serviceId` and `correlationId`;
- HTTP telemetry can be recorded without logging sensitive data.

## 4. Errors Module Agent

File: [docs/agents/03-errors-module.md](03-errors-module.md)

Task:

- implement a dedicated NestJS errors module;
- define base `ApplicationError` with:
  - `code`;
  - `message`;
  - `httpStatus`;
  - `details`;
  - optional observability metadata such as `component`, `operation`, `severity`, `retryable`;
- add common error factory methods:
  - `validation`;
  - `badRequest`;
  - `unauthorized`;
  - `notFound`;
  - `conflict`;
  - `internal`;
  - `serviceUnavailable`;
- add base error codes:
  - `validation_error`;
  - `internal_server_error`;
- implement a global exception filter;
- convert NestJS validation pipe errors to the standard `{ error, requestId }` envelope;
- read `requestId` from observability context;
- do not generate `requestId` inside the errors module;
- prepare an integration point for service error observability events.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/openapi.yaml](../openapi.yaml);
- [docs/observability.md](../observability.md);
- result of Observability Context Agent.

Expected result:

- all API errors are returned as `{ error, requestId }`;
- controllers and services do not build error responses manually;
- typed application errors exist;
- unexpected exceptions map to `internal_server_error`;
- `requestId` comes from observability context;
- public error responses do not expose stack traces, raw SQL errors, raw exception messages, headers, credentials or secrets;
- errors module does not contain business-specific mappings for users/preferences/evaluation.

## 5. Basic Auth Guard Agent

File: [docs/agents/04-basic-auth-guard.md](04-basic-auth-guard.md)

Task:

- implement Basic Auth through a NestJS Guard;
- apply the guard to all enabled HTTP endpoints;
- read credentials from configuration/environment variables:
  - `BASIC_AUTH_USERNAME`;
  - `BASIC_AUTH_PASSWORD`;
- validate the `Authorization: Basic ...` header;
- split decoded credentials by the first `:`;
- allow `:` inside the password;
- compare credentials using constant-time comparison;
- avoid logging or exposing credentials;
- return `401 Unauthorized` for missing or invalid credentials;
- add `WWW-Authenticate` header for all `401` responses;
- use the standard error envelope `{ error, requestId }`;
- add tests for auth behavior.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/security-notes.md](../security-notes.md);
- [docs/openapi.yaml](../openapi.yaml);
- result of Observability Context Agent;
- result of Errors Module Agent.

Expected result:

- all enabled HTTP endpoints are protected by Basic Auth;
- Basic Auth is implemented through a Guard;
- credentials are not hardcoded;
- credentials are not logged;
- auth errors match OpenAPI;
- `requestId` in auth errors comes from observability context;
- guard does not contain preferences/evaluation business logic;
- Basic Auth is documented as an MVP compromise and must be used only over HTTPS outside local development.

## 6. User API Agent

File: [docs/agents/05-user-api.md](05-user-api.md)

Task:

- implement technical user creation for local tests and manual verification;
- implement:

```text
POST /internal/:ecosystemCode/users
```

- make the endpoint optional through:

```text
ENABLE_INTERNAL_ENDPOINTS=true
```

- default value must be `false`;
- when `ENABLE_INTERNAL_ENDPOINTS=false`, return `404 Not Found`;
- when disabled, do not create or update users;
- when disabled, do not reveal that the internal endpoint exists;
- implement DTO and controller inside a user module;
- use NestJS structure:
  - module;
  - controller;
  - service;
  - repository;
  - DTOs;
  - types;
- make DTOs and response envelopes match [docs/openapi.yaml](../openapi.yaml);
- return successful responses as `{ data, requestId }`;
- validate input data;
- reject unknown fields;
- ensure idempotent user creation/update by:
  - `ecosystemCode + userId`;
- use Basic Auth for enabled internal endpoint;
- use `requestId` from observability context;
- define and use user module domain errors through `ErrorService`;
- map domain errors according to [docs/openapi.yaml](../openapi.yaml);
- add unit/e2e tests.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml);
- result of PostgreSQL Schema Agent;
- result of Observability Context Agent;
- result of Errors Module Agent;
- result of Basic Auth Guard Agent.

Expected result:

- `POST /internal/:ecosystemCode/users` works when enabled;
- endpoint is enabled only by `ENABLE_INTERNAL_ENDPOINTS=true`;
- disabled endpoint returns `404`;
- disabled endpoint does not create or update users;
- user API contract matches [docs/openapi.yaml](../openapi.yaml);
- repeated creation of the same user does not create duplicates;
- user is stored as local projection with `ecosystem_code + external_user_id`;
- user API errors are returned in the OpenAPI envelope;
- controller does not contain persistence logic.

## 7. Preferences Domain Agent

File: [docs/agents/06-preferences-domain.md](06-preferences-domain.md)

Task:

- implement user preferences read API;
- implement user preferences update API;
- implement DTOs and controllers inside a preferences module;
- make DTOs and response envelopes match [docs/openapi.yaml](../openapi.yaml);
- return successful responses as `{ data, requestId }`;
- validate input data;
- reject unknown fields;
- use domain types for:
  - `notificationType`;
  - `channel`;
  - `region`;
- validate IANA timezone for quiet hours;
- implement effective preference reading:
  - default preferences;
  - overridden by user preferences;
- implement idempotent upsert for user preferences;
- implement idempotent upsert for quiet hours;
- if a single request updates both preferences and quiet hours, perform the update atomically in one transaction;
- define and use preferences module domain errors:
  - `user_not_found`;
  - `notification_type_not_found`;
  - `channel_not_found`;
- map domain errors according to [docs/openapi.yaml](../openapi.yaml);
- add unit/e2e tests.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml);
- result of PostgreSQL Schema Agent;
- result of Observability Context Agent;
- result of Errors Module Agent;
- result of Basic Auth Guard Agent;
- result of User API Agent.

Expected result:

- `GET /api/:ecosystemCode/users/:userId/preferences` works;
- `POST /api/:ecosystemCode/users/:userId/preferences` works;
- preferences API contract matches [docs/openapi.yaml](../openapi.yaml);
- repeated identical updates leave the database in the same final state;
- user preferences override default preferences;
- quiet hours are stored per user;
- errors are returned in the OpenAPI envelope;
- controller does not contain persistence/business logic;
- changes do not implement evaluation logic.

## 8. Evaluation Domain Agent

File: [docs/agents/07-evaluation-domain.md](07-evaluation-domain.md)

Task:

- implement:

```text
POST /api/:ecosystemCode/evaluate
```

- implement DTO and controller inside an evaluation module;
- make DTO and response envelope match [docs/openapi.yaml](../openapi.yaml);
- return successful response as `{ data, requestId }`;
- validate input data;
- reject unknown fields;
- use domain types for:
  - `notificationType`;
  - `channel`;
  - `region`;
  - `datetime`;
- reject invalid datetime;
- reject naive/local datetime without timezone offset;
- reject datetime in the past;
- tests must generate future datetimes dynamically;
- use a consistent approach to dates and timezones;
- apply decision rules in the exact order:
  1. matching global deny policy;
  2. quiet hours, only if the notification type respects quiet hours;
  3. user preference;
  4. default preference;
  5. fallback deny;
- correctly handle IANA timezone conversion;
- correctly handle quiet hours crossing midnight;
- return stable `decision`, `reason` and `source`;
- keep decision reasons separate from API error codes;
- unknown user/type/channel must return `404`, not a successful `deny`;
- define and use evaluation module domain errors:
  - `user_not_found`;
  - `notification_type_not_found`;
  - `channel_not_found`;
- map domain errors according to [docs/openapi.yaml](../openapi.yaml);
- add tests for key scenarios.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/openapi.yaml](../openapi.yaml);
- result of Preferences Domain Agent;
- result of User API Agent;
- result of Observability Context Agent;
- result of Errors Module Agent;
- result of Basic Auth Guard Agent.

Expected result:

- decision API works;
- evaluation API contract matches [docs/openapi.yaml](../openapi.yaml);
- `allow` / `deny` decision is explained through stable `reason` and `source`;
- global deny policy has the highest priority;
- quiet hours are applied only to notification types with `respects_quiet_hours = true`;
- user preference overrides default preference;
- default preference is used when user preference does not exist;
- fallback deny works;
- evaluation errors are returned in the OpenAPI envelope;
- business rules are covered by tests;
- evaluation module does not mutate users, preferences, quiet hours, default preferences or global policies.

## 9. Observability Events and Metrics Agent

File: [docs/agents/08-observability.md](08-observability.md)

Task:

- complete `ObservabilityModule`;
- keep and reuse the existing observability context from `02-observability-context.md`;
- add stdout/application logger sink for structured events;
- implement recording of key events:
  - preference changes;
  - quiet hours changes;
  - notification decisions;
  - service errors;
  - auth failures;
- implement HTTP telemetry if not already fully implemented in the context stage;
- add structure for counters and timers;
- ensure observability sink failure is non-blocking for the main API flow.

This stage completes MVP observability without a dedicated observability database.

ClickHouse, Prometheus, OpenTelemetry, a message broker or an external observability platform remain production extensions after the MVP.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/observability.md](../observability.md);
- result of Observability Context Agent;
- result of User API Agent;
- result of Preferences Domain Agent;
- result of Evaluation Domain Agent;
- result of Errors Module Agent;
- result of Basic Auth Guard Agent.

Expected result:

- events and metrics are written as structured output to stdout/application logger;
- all events include `requestId`, `serviceId` and optional `correlationId` when available;
- observability failures do not break the main flow;
- sensitive data is not logged;
- there is a foundation for production sinks and alerts on errors/latency.

## 10. Tests and README Agent

File: [docs/agents/09-tests-and-readme.md](09-tests-and-readme.md)

Task:

- verify all main scenarios end-to-end;
- cover mandatory assignment scenarios:
  - default preferences for a new user;
  - user preference update;
  - user preferences overriding defaults;
  - quiet hours blocking non-critical notifications;
  - transactional/security notifications during quiet hours if they do not respect quiet hours;
  - global policies;
  - idempotent repeated preference update;
  - idempotent repeated quiet-hours update;
  - fallback deny;
- cover infrastructure scenarios:
  - observability context middleware;
  - request id propagation;
  - error envelope;
  - Basic Auth guard;
  - disabled internal endpoint behavior;
  - validation errors;
  - unknown user/type/channel;
- update README:
  - project startup;
  - PostgreSQL startup;
  - migrations;
  - seed scripts;
  - tests;
  - Basic Auth usage;
  - request id / observability behavior;
  - curl examples;
  - known limitations;
- compare the implementation against the original assignment requirements;
- explicitly list known limitations and production improvements.

Input documents:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/business-logic.md](../business-logic.md);
- [docs/observability.md](../observability.md);
- [docs/security-notes.md](../security-notes.md);
- [docs/openapi.yaml](../openapi.yaml);
- results of all previous agents.

Expected result:

- project can be started by following README;
- migrations and seeds are documented;
- tests pass;
- reviewer can quickly verify key scenarios;
- original assignment requirements are explicitly covered;
- known limitations are documented.

## Recommended Execution Order

1. [00-general-instructions.md](00-general-instructions.md)
2. [01-postgres-schema.md](01-postgres-schema.md)
3. [02-observability-context.md](02-observability-context.md)
4. [03-errors-module.md](03-errors-module.md)
5. [04-basic-auth-guard.md](04-basic-auth-guard.md)
6. [05-user-api.md](05-user-api.md)
7. [06-preferences-domain.md](06-preferences-domain.md)
8. [07-evaluation-domain.md](07-evaluation-domain.md)
9. [08-observability.md](08-observability.md)
10. [09-tests-and-readme.md](09-tests-and-readme.md)

After `00`, `01`, `02`, `03`, `04` and `05` are ready, some tasks can be parallelized.

However:

- `06-preferences-domain.md` should be completed before `07-evaluation-domain.md`, because evaluation depends on the preferences model.
- `02-observability-context.md` must be completed early, because errors, auth, controllers, services and filters need `requestId`.
- `08-observability.md` should be completed after the main domain modules, because domain events depend on user/preferences/evaluation behavior.
