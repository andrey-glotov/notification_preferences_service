# Agent 08: Observability Events and Metrics

## Goal

Complete the MVP observability module for Notification Preferences Service.

This stage must add production-like structured observability without introducing a dedicated observability database.

The MVP observability module must collect:

- structured events;
- counters;
- timers;
- service error events;
- authentication failure events;
- domain events for preference changes and notification decisions.

Default MVP sink:

```text
stdout / application logger
```

ClickHouse, Prometheus, OpenTelemetry, a message broker, or an external observability platform are production extensions after the MVP.

## Input Documents

Before starting, read:

- [docs/agents/00-general-instructions.md](00-general-instructions.md);
- [docs/agents/02-observability-context.md](02-observability-context.md);
- [docs/agents/03-errors-module.md](03-errors-module.md);
- [docs/agents/04-basic-auth-guard.md](04-basic-auth-guard.md);
- [docs/agents/05-user-api.md](05-user-api.md);
- [docs/agents/06-preferences-domain.md](06-preferences-domain.md);
- [docs/agents/07-evaluation-domain.md](07-evaluation-domain.md);
- [docs/observability.md](../observability.md);
- [docs/security-notes.md](../security-notes.md);
- [docs/openapi.yaml](../openapi.yaml).

## Dependencies from Previous Stages

This stage depends on:

- observability context:
  - `requestId`;
  - `serviceId`;
  - optional `correlationId`;
  - `ObservabilityContextService`;
- errors module:
  - global exception filter;
  - `ApplicationError`;
  - `ErrorService`;
- Basic Auth guard:
  - auth failures and auth misconfiguration errors;
- preferences domain:
  - user preference changes;
  - quiet hours changes;
- evaluation domain:
  - notification decisions.

This stage must reuse the existing observability context.

Do not implement another request context.

Do not generate `requestId` in this stage.

## Scope

This stage may implement:

- `ObservabilityService`;
- event recording API;
- counter recording API;
- timer recording API;
- stdout/application logger sink;
- safe event payload types;
- integration with preferences service;
- integration with evaluation service;
- integration with errors module/global exception filter;
- integration with Basic Auth guard or auth error path;
- tests for observability behavior.

This stage must not implement:

- ClickHouse sink;
- Prometheus exporter;
- OpenTelemetry exporter;
- broker-based async delivery;
- external logging platform integration;
- alerting engine;
- dashboard definitions;
- business decision logic.

## Existing Context Stage

Agent 02 already owns request correlation.

The following behavior must already exist or be preserved:

```text
ObservabilityMiddleware
  - reads or generates requestId
  - reads correlationId
  - reads serviceId
  - stores observability context
  - adds X-Request-Id response header
  - may measure HTTP request duration
```

This stage must extend the observability module but must not move request correlation elsewhere.

## Recommended Structure

Recommended files:

```text
src/observability/
  observability.module.ts
  observability.service.ts
  observability.sink.ts
  stdout-observability.sink.ts
  observability.types.ts
  observability-events.ts
  observability-metrics.ts
```

If these files were partially created by Agent 02, extend them instead of duplicating functionality.

Recommended existing files from Agent 02:

```text
src/observability/
  observability.middleware.ts
  observability-context.service.ts
  observability-context.types.ts
  request-id.ts
```

Do not duplicate context types or request id helpers.

## 1. Observability Module

Complete the existing:

```text
ObservabilityModule
```

The module must provide:

- `ObservabilityService`;
- `ObservabilitySink` abstraction;
- `StdoutObservabilitySink`;
- context access through existing `ObservabilityContextService`.

The module must be connected to the root application module.

The module must be usable from:

- preferences service;
- evaluation service;
- auth guard;
- global exception filter;
- HTTP middleware.

## 2. Observability Service API

`ObservabilityService` must expose application-level methods.

Minimum generic methods:

```ts
recordEvent(input): void | Promise<void>;
recordCounter(input): void | Promise<void>;
recordTimer(input): void | Promise<void>;
```

Recommended specialized methods:

```ts
recordPreferenceChanged(input): void | Promise<void>;
recordQuietHoursChanged(input): void | Promise<void>;
recordNotificationDecision(input): void | Promise<void>;
recordServiceError(input): void | Promise<void>;
recordAuthFailure(input): void | Promise<void>;
incrementCounter(input): void | Promise<void>;
recordDuration(input): void | Promise<void>;
```

Specialized methods are allowed if they reduce repeated code in domain modules.

Important rule:

The observability module must not contain business decision logic.

It only records facts that were already produced by other modules.

Examples:

- Preferences service decides that a preference changed.
- Evaluation service decides `allow` or `deny`.
- Auth guard decides auth failure.
- Exception filter maps an error.
- Observability service records these facts.

## 3. Sink Abstraction

Create a sink abstraction.

Recommended interface:

```ts
interface ObservabilitySink {
  write(event: ObservabilityRecord): Promise<void> | void;
}
```

For MVP, implement:

```text
StdoutObservabilitySink
```

The sink must write structured JSON events to stdout or the standard application logger.

Requirements:

- output must be structured;
- output format must be stable;
- sink failure must not break the main request flow;
- sink must not log sensitive data;
- sink must not throw into business flow.

If the sink throws, `ObservabilityService` must catch the error and optionally use a safe fallback logger.

Do not implement retry loops that delay user requests.

## 4. Base Event Format

All structured observability events must include:

```json
{
  "eventType": "notification_decision",
  "requestId": "req_1779604200123456789_a3f91c",
  "serviceId": "notification-preferences-service",
  "correlationId": null,
  "component": "evaluation",
  "operation": "evaluate_notification",
  "severity": "info",
  "timestamp": "2026-05-24T10:15:30.123Z",
  "payload": {}
}
```

Required base fields:

- `eventType`;
- `requestId`;
- `serviceId`;
- `correlationId`;
- `component`;
- `operation`;
- `severity`;
- `timestamp`;
- `payload`.

Severity values:

```text
info
warning
error
critical
```

Rules:

- `requestId`, `serviceId` and `correlationId` must come from `ObservabilityContextService` when available;
- if there is no HTTP context, `requestId` may be `null`;
- `serviceId` must still be set from config/default;
- `timestamp` must be an ISO timestamp in UTC;
- `payload` must contain only safe structured data;
- event output must not contain raw request headers, credentials or raw request bodies.

## 5. Preference Change Events

Create event after successful changes to:

- `user_preferences`;
- `quiet_hours`.

Event types:

```text
preference_changed
quiet_hours_changed
```

### 5.1 Preference Changed Payload

Payload example:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1",
  "notificationType": "marketing",
  "channel": "email",
  "allowed": false,
  "source": "user_preference"
}
```

Required fields:

- `ecosystemCode`;
- `userId`;
- `notificationType`;
- `channel`;
- `allowed`;
- `source`.

Rules:

- emit only after the database transaction succeeds;
- if the request changes multiple preferences, record one event per changed preference or one batch event with a clearly structured array;
- do not emit events for failed or rolled-back updates;
- repeated idempotent request may either:
  - emit an idempotent event with `changed: false`; or
  - emit no change event if nothing changed.
- choose one behavior and document it in the final report.

### 5.2 Quiet Hours Changed Payload

Payload example:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1",
  "startTime": "22:00",
  "endTime": "08:00",
  "timezone": "Asia/Yekaterinburg"
}
```

Required fields:

- `ecosystemCode`;
- `userId`;
- `startTime`;
- `endTime`;
- `timezone`.

Rules:

- emit only after the database transaction succeeds;
- do not emit events for failed or rolled-back updates;
- do not include before/after snapshots unless they are explicitly safe;
- if snapshots are added, they must not contain sensitive data.

## 6. Notification Decision Events

Create event after every successful call to:

```text
POST /api/:ecosystemCode/evaluate
```

Event type:

```text
notification_decision
```

Payload example:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1",
  "notificationType": "marketing",
  "channel": "email",
  "region": "EU",
  "datetime": "2026-05-24T10:30:00.000Z",
  "decision": "deny",
  "reason": "blocked_by_global_policy",
  "source": "global_policy",
  "durationMs": 12
}
```

Required fields:

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

Rules:

- emit only after successful evaluation;
- unknown user/type/channel errors are not notification decisions;
- validation errors are not notification decisions;
- `reason` and `source` must match the public decision values returned by the evaluation API;
- do not use raw global policy reason as public/event decision reason unless it is already a stable enum;
- use stable enum values from OpenAPI/business rules.

## 7. Service Error Events

Create event for errors that may require investigation or alerting:

- unexpected exceptions;
- PostgreSQL errors;
- Basic Auth failures;
- Basic Auth misconfiguration;
- observability sink errors;
- future integration errors.

Event type:

```text
service_error
```

Payload example:

```json
{
  "errorCode": "internal_server_error",
  "errorMessage": "Internal server error.",
  "component": "api",
  "operation": "handle_request",
  "retryable": false,
  "metadata": {}
}
```

Required fields:

- `errorCode`;
- `errorMessage`;
- `component`;
- `operation`;
- `retryable`;
- `metadata`.

Rules:

- record from the global exception filter or errors integration point;
- use sanitized public error message or safe internal message;
- do not include raw exception object in payload;
- do not include stack trace unless it is internal-only and explicitly sanitized;
- do not include raw SQL errors;
- do not include request headers;
- do not include credentials.

### 7.1 Auth Failure Events

For auth failures:

```text
eventType = service_error
errorCode = unauthorized
component = auth
operation = basic_auth
severity = warning
```

Optional metric:

```text
auth_failures_total
```

Rules:

- do not record username;
- do not record password;
- do not record Authorization header;
- do not record decoded credentials;
- do not reveal whether username or password was wrong.

### 7.2 Auth Misconfiguration Events

For auth misconfiguration:

```text
eventType = service_error
errorCode = basic_auth_misconfigured
component = auth
operation = basic_auth
severity = critical
```

Rules:

- do not record env variable values;
- do not record configured username/password;
- public response remains `internal_server_error`.

### 7.3 Observability Sink Error Events

If sink write fails:

- do not fail the main request;
- use fallback logger if available;
- avoid recursive infinite logging loops.

Recommended event/fallback metadata:

```text
eventType = service_error
errorCode = observability_sink_error
component = observability
operation = write_event
severity = error
```

Do not retry in a tight loop.

## 8. Metrics

For MVP, metrics may be represented as structured events sent to the sink.

### 8.1 Counter Event

Counter event example:

```json
{
  "metricType": "counter",
  "metricName": "notification_decision_total",
  "value": 1,
  "labels": {
    "decision": "deny",
    "source": "global_policy",
    "channel": "email"
  }
}
```

Required fields:

- `metricType = counter`;
- `metricName`;
- `value`;
- `labels`.

Recommended counters:

- `preference_changes_total`;
- `quiet_hours_changes_total`;
- `notification_decision_total`;
- `notification_decision_allowed_total`;
- `notification_decision_denied_total`;
- `service_errors_total`;
- `auth_failures_total`;
- `http_requests_total`;
- `http_requests_failed_total`.

### 8.2 Timer Event

Timer event example:

```json
{
  "metricType": "timer",
  "metricName": "notification_decision_duration_ms",
  "durationMs": 12,
  "labels": {
    "operation": "evaluate_notification"
  }
}
```

Required fields:

- `metricType = timer`;
- `metricName`;
- `durationMs`;
- `labels`.

Recommended timers:

- `preferences_update_duration_ms`;
- `notification_decision_duration_ms`;
- `basic_auth_guard_duration_ms`;
- `postgres_query_duration_ms`;
- `http_request_duration_ms`.

### 8.3 Metric Label Safety

Metric labels must be low-cardinality and safe.

Allowed labels:

- `decision`;
- `source`;
- `channel`;
- `operation`;
- `component`;
- `statusCode`;
- normalized route pattern;
- error code.

Avoid high-cardinality labels:

- raw `userId`;
- raw `requestId`;
- raw `correlationId`;
- raw datetime;
- raw error message;
- raw URL with query string.

Do not put sensitive data in labels.

## 9. HTTP Telemetry

If Agent 02 already added HTTP duration measurement, extend it with structured events/counters/timers.

Recommended HTTP events:

```text
http_request_started
http_request_completed
http_request_failed
```

Safe HTTP payload fields:

- method;
- normalized route pattern;
- status code;
- durationMs;
- requestId;
- serviceId;
- correlationId.

Do not log:

- raw headers;
- Authorization header;
- cookies;
- raw body;
- full URL with sensitive query params.

If normalized route pattern is not available reliably, use a safe placeholder or omit it.

Do not log uncontrolled high-cardinality raw paths if they may contain user ids or secrets.

## 10. Non-Blocking Behavior

Observability must never be a source of truth.

Rules:

- if event recording fails, the main operation must still succeed;
- if counter/timer recording fails, the main operation must still succeed;
- if the sink is unavailable, API responses must still be returned;
- observability errors may be logged through a fallback logger;
- no retry loop may delay user requests;
- no observability error may roll back PostgreSQL transactions.

Important transaction rule:

- domain events related to database updates must be emitted only after a successful transaction;
- never emit successful change events for rolled-back changes.

## 11. Security and Privacy

Forbidden in events, metrics labels and output:

- `Authorization` header;
- Basic Auth username/password;
- decoded Basic credentials;
- cookies;
- access tokens;
- refresh tokens;
- API keys;
- private keys;
- env values;
- connection strings;
- raw SQL errors;
- raw exception objects;
- raw request body;
- full request headers;
- stack trace in public API response;
- payloads that may contain sensitive data.

Stack trace may be included only in internal service error events for unexpected exceptions and only after checking that it does not expose secrets.

For MVP, `userId` may be included in domain events because it is part of the business context.

For production, user identifiers may require hashing, pseudonymization or stricter data handling.

## 12. Integration Points

### 12.1 Preferences Integration

Preferences service should call observability after successful updates.

Suggested calls:

```ts
observability.recordPreferenceChanged(...);
observability.recordQuietHoursChanged(...);
observability.incrementCounter({ metricName: 'preference_changes_total', ... });
observability.recordDuration({ metricName: 'preferences_update_duration_ms', ... });
```

Events must be emitted after successful database commit.

### 12.2 Evaluation Integration

Evaluation service should call observability after successful decision.

Suggested calls:

```ts
observability.recordNotificationDecision(...);
observability.incrementCounter({ metricName: 'notification_decision_total', ... });
observability.recordDuration({ metricName: 'notification_decision_duration_ms', ... });
```

Decision counters should distinguish:

- `allow`;
- `deny`;
- `source`;
- `channel`.

### 12.3 Errors Integration

Global exception filter should call observability for service errors.

Suggested calls:

```ts
observability.recordServiceError(...);
observability.incrementCounter({ metricName: 'service_errors_total', ... });
```

The call must be non-blocking.

If observability fails while recording an error, preserve the original API error response.

### 12.4 Auth Integration

Basic Auth guard or errors integration should record auth failures.

Suggested calls:

```ts
observability.recordAuthFailure(...);
observability.incrementCounter({ metricName: 'auth_failures_total', ... });
observability.recordDuration({ metricName: 'basic_auth_guard_duration_ms', ... });
```

Do not include credentials or raw auth headers.

## 13. What Not to Do

Do not implement:

- ClickHouse sink;
- Prometheus exporter;
- OpenTelemetry exporter;
- message broker sink;
- external log platform integration;
- alerting rules;
- dashboards;
- business decision logic;
- request id generation;
- second request context system.

Do not modify business decisions inside observability module.

Do not block API responses because observability failed.

Do not put sensitive data in events or metrics.

## 14. Tests

Add unit and/or integration tests for observability behavior.

Minimum scenarios:

### Context reuse

- observability events include `requestId` from `ObservabilityContextService`;
- observability events include `serviceId`;
- observability events include `correlationId` when available;
- outside HTTP context, `requestId` may be `null` and `serviceId` is still set.

### Sink behavior

- `StdoutObservabilitySink` writes structured records;
- sink receives event records with required base fields;
- sink failure does not throw into business flow;
- fallback behavior avoids infinite recursion.

### Domain events

- preference update records `preference_changed` after successful update;
- quiet hours update records `quiet_hours_changed` after successful update;
- failed/rolled-back preference update does not record successful change event;
- evaluation records `notification_decision` after successful decision;
- evaluation validation error does not record `notification_decision`.

### Error/auth events

- unexpected exception records `service_error`;
- Basic Auth failure records auth failure metadata or service error;
- auth failure event does not contain credentials;
- auth misconfiguration event does not contain env values.

### Metrics

- preference change counter is recorded;
- notification decision counter is recorded;
- allow/deny counters are recorded or labels distinguish decision;
- duration timer is recorded for evaluation;
- metric labels do not include raw `userId`, raw `requestId` or raw error messages.

### Safety

- events do not contain `Authorization` header;
- events do not contain decoded Basic credentials;
- events do not contain connection strings;
- events do not contain raw SQL errors;
- events do not contain raw request body.

If full e2e tests are too expensive, use focused unit tests with fake sink and fake observability context.

## 15. Verification

Before reporting completion, run:

```bash
pnpm run build
```

If the project has a test script, run:

```bash
pnpm test
```

If PostgreSQL is required for some integration tests and is not running, clearly state this in the final report and execute available unit/build checks.

## 16. Completion Criteria

The task is complete when:

- `ObservabilityModule` is complete;
- existing `ObservabilityContextService` is reused;
- no second request context is introduced;
- `ObservabilityService` exists;
- sink abstraction exists;
- stdout/application logger sink exists;
- structured event format is stable;
- preference change events are recorded;
- quiet hours change events are recorded;
- notification decision events are recorded;
- service error events are supported;
- auth failure events are supported;
- counters are supported;
- timers are supported;
- observability failures do not break API flow;
- observability failures do not roll back database operations;
- sensitive data is not logged;
- tests cover required observability scenarios;
- build passes.

## 17. Agent Final Report Format

At the end of the task, the agent must briefly report:

- files changed;
- how `ObservabilityModule` was completed;
- how existing observability context is reused;
- how `ObservabilityService` API is structured;
- how sink abstraction is implemented;
- how stdout/application logger sink is implemented;
- which events are recorded;
- which counters are recorded;
- which timers are recorded;
- how non-blocking behavior is guaranteed;
- how sensitive data is filtered or avoided;
- which integrations were added:
  - preferences;
  - evaluation;
  - errors;
  - auth;
- tests or checks executed;
- anything that could not be completed or verified, with exact reason.
