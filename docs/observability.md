# Observability

Документ описывает observability-подход для Notification Preferences Service.

Для MVP не нужно строить собственную observability-систему и поднимать отдельное хранилище. Достаточно реализовать production-like NestJS-модуль, который:

- создает observability context для HTTP-запросов;
- собирает структурированные события;
- собирает счетчики;
- собирает таймеры;
- отправляет записи в настраиваемый sink.

Sink по умолчанию для MVP:

```text
stdout / application logger
```

ClickHouse, Prometheus, OpenTelemetry, брокер сообщений или внешняя observability-платформа остаются возможными production sinks после MVP.

## Цели MVP

Минимальное требование тестового задания:

- единый `requestId` для API responses, errors и observability events;
- базовое логирование изменений настроек;
- базовое логирование решений `allow` / `deny`;
- структура для метрик: counters и timers;
- возможность реагировать на ошибки через structured error events;
- безопасный stdout/application logger sink;
- non-blocking behavior observability слоя.

MVP должен отвечать на вопросы:

- какой HTTP-запрос связан с конкретным событием;
- кто и когда изменил настройки пользователя;
- почему сервис вернул `allow` или `deny`;
- какие ошибки происходят в сервисе;
- какие запросы связаны с конкретным `requestId`;
- какой экземпляр/сервис записал событие через `serviceId`;
- сколько было ключевых операций;
- сколько времени занимали ключевые операции.

## Архитектурный подход

Нужен отдельный NestJS-модуль:

```text
ObservabilityModule
```

Модуль отвечает за две группы задач:

1. Observability context и HTTP-level telemetry.
2. Structured events, counters, timers и sink.

## Observability context

Observability context создается в начале каждого HTTP-запроса.

Контекст содержит:

- `requestId`;
- `serviceId`;
- `correlationId`, если он есть.

За создание context отвечает:

```text
ObservabilityMiddleware
```

`ObservabilityMiddleware` должен:

- читать `X-Request-Id` из HTTP headers;
- валидировать входящий `X-Request-Id`;
- генерировать новый `requestId`, если header отсутствует или невалиден;
- читать `X-Correlation-Id`, если он передан и валиден;
- читать `SERVICE_ID` из конфигурации;
- использовать `notification-preferences-service` как `serviceId` по умолчанию;
- сохранять `requestId`, `serviceId`, `correlationId` в context storage;
- делать context доступным для controllers, services, guards, interceptors, exception filters и observability services;
- добавлять `X-Request-Id` в response headers;
- измерять duration HTTP-запроса;
- готовить или писать HTTP-level telemetry.

`ObservabilityMiddleware` должен выполняться раньше guard/controller/filter кода, которому нужен `requestId`.

Errors module, Basic Auth guard и domain services должны использовать уже существующий observability context.

Они не должны генерировать собственный `requestId`.

## Request ID

Middleware читает header:

```text
X-Request-Id
```

Правила:

- если header передан и валиден, использовать его;
- если header отсутствует, сгенерировать новый `requestId`;
- если header невалиден, проигнорировать его и сгенерировать новый `requestId`;
- не возвращать ошибку клиенту из-за невалидного `X-Request-Id`;
- итоговый `requestId` должен быть один и тот же на протяжении всего request lifecycle;
- итоговый `requestId` должен попадать в response header `X-Request-Id`;
- success envelope должен использовать этот `requestId`;
- error envelope должен использовать этот `requestId`;
- observability events должны использовать этот `requestId`.

Рекомендуемый формат генерируемого `requestId`:

```text
req_<unix_epoch_ns>_<random_suffix>
```

Пример:

```text
req_1779604200123456789_a3f91c
```

Правила генерации:

- timestamp part должен быть основан на текущем Unix time;
- timestamp должен быть достаточно монотонным внутри процесса, чтобы избежать дублей при конкурентных запросах;
- random suffix снижает риск коллизий между несколькими service instances;
- `requestId` не должен содержать `serviceId`, hostname, pod name, user id, IP address или другие infrastructure/user-identifying данные.

В Node.js допустимо использовать `Date.now()` вместе с `process.hrtime.bigint()` или другой монотонный источник.

Если точный epoch nanoseconds получить сложно, допустимо использовать epoch milliseconds + monotonic nano-offset + random suffix, сохранив формат:

```text
req_<time_ns>_<random_suffix>
```

Валидация входящего `X-Request-Id`:

- строка;
- длина от 8 до 128 символов;
- допустимые символы:
  - латинские буквы;
  - цифры;
  - `_`;
  - `-`;
  - `.`;
  - `:`.

Если значение не проходит проверку, оно заменяется новым сгенерированным `requestId`.

Не логировать полный набор headers.

## Service ID

`serviceId` берется из env/config:

```text
SERVICE_ID
```

Если значение не задано, использовать:

```text
notification-preferences-service
```

`serviceId` должен быть доступен через `ObservabilityContextService`.

Вне HTTP request context `getServiceId()` должен возвращать config/default value.

## Correlation ID

Для будущей интеграции с брокером и distributed flows поддерживается optional `correlationId`.

Для HTTP-запросов можно читать header:

```text
X-Correlation-Id
```

Правила:

- если header отсутствует, `correlationId = null`;
- если header передан и валиден, сохранить его в observability context;
- если header невалиден, проигнорировать его и использовать `null`;
- не возвращать ошибку клиенту из-за невалидного `X-Correlation-Id`;
- не добавлять `correlationId` в API response envelope, если это не описано в `docs/openapi.yaml`.

По умолчанию можно использовать те же правила валидации, что и для `X-Request-Id`.

## ObservabilityContextService

Модуль должен предоставлять service для чтения текущего context.

Минимальные методы:

```ts
getRequestId(): string | null;
getServiceId(): string;
getCorrelationId(): string | null;
getContext(): ObservabilityContext | null;
```

Поведение внутри HTTP request context:

- `getRequestId()` возвращает текущий `requestId`;
- `getServiceId()` возвращает текущий `serviceId`;
- `getCorrelationId()` возвращает текущий `correlationId` или `null`;
- `getContext()` возвращает весь context.

Поведение вне HTTP request context:

- `getRequestId()` возвращает `null`;
- `getCorrelationId()` возвращает `null`;
- `getServiceId()` возвращает config/default value;
- `getContext()` возвращает `null`.

Это нужно для:

- seed scripts;
- future background jobs;
- future message consumers;
- tests outside HTTP context.

## HTTP telemetry

`ObservabilityMiddleware` может писать технические HTTP events:

```text
http_request_started
http_request_completed
http_request_failed
```

Также он может писать counters/timers:

```text
http_requests_total
http_requests_failed_total
http_request_duration_ms
```

Safe HTTP payload fields:

- method;
- normalized route pattern;
- statusCode;
- durationMs;
- requestId;
- serviceId;
- correlationId.

Не логировать:

- raw headers;
- `Authorization` header;
- cookies;
- raw body;
- full URL с sensitive query params.

Если normalized route pattern недоступен надежно, лучше использовать safe placeholder или не писать route, чем логировать uncontrolled high-cardinality raw path.

## Application-level API

`ObservabilityModule` должен предоставлять application-level API:

```ts
recordEvent(...);
recordCounter(...);
recordTimer(...);
```

Можно добавить специализированные методы, если это упрощает код:

```ts
recordPreferenceChanged(...);
recordQuietHoursChanged(...);
recordNotificationDecision(...);
recordServiceError(...);
recordAuthFailure(...);
incrementCounter(...);
recordDuration(...);
```

Observability module не должен содержать бизнес-логику принятия решений.

Он только принимает уже сформированный факт события или метрики и отправляет его в sink.

Примеры:

- Preferences service определяет, что preference изменилась.
- Evaluation service определяет `allow` или `deny`.
- Auth guard определяет auth failure.
- Exception filter определяет service error.
- Observability service только записывает эти факты.

## Sink

Sink — это абстракция назначения, куда отправляются observability records.

Для MVP достаточно одного sink:

```text
StdoutObservabilitySink
```

Он пишет структурированные JSON-записи в stdout или стандартный application logger.

Требования:

- запись в sink не должна ломать основной flow;
- ошибка sink должна быть поймана;
- ошибка sink не должна откатывать PostgreSQL-операцию;
- sink не должен логировать sensitive data;
- формат события должен быть стабильным и удобным для парсинга;
- не должно быть retry-loop, который задерживает пользовательский запрос.

Рекомендуемый interface:

```ts
interface ObservabilitySink {
  write(record: ObservabilityRecord): Promise<void> | void;
}
```

Future sinks:

- ClickHouse;
- Prometheus / metrics exporter;
- OpenTelemetry;
- брокер сообщений;
- external log platform.

## Общий формат события

Все events должны быть структурированными.

Базовый формат:

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

Обязательные base fields:

- `eventType`;
- `requestId`;
- `serviceId`;
- `correlationId`;
- `component`;
- `operation`;
- `severity`;
- `timestamp`;
- `payload`.

Рекомендуемые `severity`:

- `info`;
- `warning`;
- `error`;
- `critical`.

Правила:

- `requestId`, `serviceId`, `correlationId` берутся из `ObservabilityContextService`, если context доступен;
- если HTTP context отсутствует, `requestId` может быть `null`;
- `serviceId` должен быть заполнен из config/default даже вне HTTP context;
- `timestamp` должен быть UTC ISO timestamp;
- `payload` должен содержать только безопасные structured data;
- output не должен содержать raw headers, credentials или raw request body.

## События изменений настроек

Событие создается после успешного изменения:

- `user_preferences`;
- `quiet_hours`.

Event types:

```text
preference_changed
quiet_hours_changed
```

### preference_changed

Payload:

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

Обязательные поля:

- `ecosystemCode`;
- `userId`;
- `notificationType`;
- `channel`;
- `allowed`;
- `source`.

Правила:

- event создается только после успешного database commit;
- если transaction откатилась, successful change event писать нельзя;
- если request меняет несколько preferences, можно писать:
  - отдельное событие на каждую измененную preference;
  - или batch event со структурированным массивом;
- поведение для повторного idempotent запроса нужно выбрать явно:
  - не писать event, если фактического изменения не было;
  - или писать idempotent event с `changed: false`.

### quiet_hours_changed

Payload:

```json
{
  "ecosystemCode": "vk",
  "userId": "user-1",
  "startTime": "22:00",
  "endTime": "08:00",
  "timezone": "Asia/Yekaterinburg"
}
```

Обязательные поля:

- `ecosystemCode`;
- `userId`;
- `startTime`;
- `endTime`;
- `timezone`.

Правила:

- event создается только после успешного database commit;
- если transaction откатилась, successful change event писать нельзя;
- before/after snapshots не обязательны для MVP;
- если snapshots добавляются, они не должны содержать sensitive data.

## События решений

Событие создается после каждого успешного вызова:

```text
POST /api/:ecosystemCode/evaluate
```

Event type:

```text
notification_decision
```

Payload:

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

Обязательные поля:

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

Правила:

- event создается только после successful evaluation;
- validation errors не являются notification decisions;
- `404 not_found` для unknown user/type/channel не является notification decision;
- `reason` и `source` должны совпадать с публичными значениями evaluation API;
- нельзя использовать raw `global_policies.reason` как произвольный public/event reason, если он не является стабильным enum из OpenAPI.

## События ошибок

Событие создается для ошибок, на которые потенциально нужно реагировать:

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

Payload:

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

Обязательные поля:

- `errorCode`;
- `errorMessage`;
- `component`;
- `operation`;
- `retryable`;
- `metadata`.

Правила:

- event пишется из global exception filter или errors integration point;
- использовать sanitized public error message или safe internal message;
- не добавлять raw exception object;
- не добавлять raw SQL errors;
- не добавлять request headers;
- не добавлять credentials.

### Auth failures

Для auth failures:

```text
eventType = service_error
errorCode = unauthorized
component = auth
operation = basic_auth
severity = warning
```

Дополнительная метрика:

```text
auth_failures_total
```

Правила:

- не писать username;
- не писать password;
- не писать Authorization header;
- не писать decoded credentials;
- не раскрывать, username или password был неверным.

### Auth misconfiguration

Для auth misconfiguration:

```text
eventType = service_error
errorCode = basic_auth_misconfigured
component = auth
operation = basic_auth
severity = critical
```

Правила:

- не писать env values;
- не писать configured username/password;
- публичный response остается `internal_server_error`.

### Observability sink errors

Если sink write падает:

- основной request не должен падать;
- использовать fallback logger, если он есть;
- избегать infinite recursive logging loop.

Рекомендуемые metadata:

```text
eventType = service_error
errorCode = observability_sink_error
component = observability
operation = write_event
severity = error
```

## Метрики

Для MVP metrics могут быть представлены как structured events, отправляемые в sink.

### Counter event

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

Обязательные поля:

- `metricType = counter`;
- `metricName`;
- `value`;
- `labels`.

Рекомендуемые counters:

- `preference_changes_total`;
- `quiet_hours_changes_total`;
- `notification_decision_total`;
- `notification_decision_allowed_total`;
- `notification_decision_denied_total`;
- `service_errors_total`;
- `auth_failures_total`;
- `http_requests_total`;
- `http_requests_failed_total`.

### Timer event

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

Обязательные поля:

- `metricType = timer`;
- `metricName`;
- `durationMs`;
- `labels`.

Рекомендуемые timers:

- `preferences_update_duration_ms`;
- `notification_decision_duration_ms`;
- `basic_auth_guard_duration_ms`;
- `postgres_query_duration_ms`;
- `http_request_duration_ms`.

### Безопасность labels

Metric labels должны быть low-cardinality и безопасными.

Разрешенные labels:

- `decision`;
- `source`;
- `channel`;
- `operation`;
- `component`;
- `statusCode`;
- normalized route pattern;
- error code.

Не использовать в labels:

- raw `userId`;
- raw `requestId`;
- raw `correlationId`;
- raw datetime;
- raw error message;
- raw URL с query string.

## Безопасность логов

Запрещено писать в observability events, metrics labels и output:

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
- stack trace в публичном API response;
- payload целиком, если он может содержать sensitive data.

Stack trace допустим только во внутренних `service_error` events для unexpected errors и только после проверки, что он не раскрывает secrets.

Stack trace никогда не должен попадать в публичный API response.

Для MVP `userId` может присутствовать в domain events, потому что это часть бизнес-контекста.

Для production может потребоваться hashing, pseudonymization или более строгая обработка пользовательских идентификаторов.

## Неблокирующее поведение

Observability не является источником истины.

Правила:

- если запись event не удалась, основная операция не должна откатываться;
- если запись counter/timer не удалась, основная операция не должна откатываться;
- если sink недоступен, сервис должен продолжать отвечать на API-запросы;
- ошибка sink-а может быть залогирована через fallback logger;
- не делать retry-loop, который может задержать пользовательский запрос;
- observability error не должен откатывать PostgreSQL transaction.

Важное правило для domain events:

- события, связанные с изменениями в БД, должны писаться только после успешного commit;
- successful change events нельзя писать для rolled-back изменений.

## Integration points

### Preferences integration

Preferences service должен вызывать observability после успешных updates.

Примеры:

```ts
observability.recordPreferenceChanged(...);
observability.recordQuietHoursChanged(...);
observability.incrementCounter({ metricName: 'preference_changes_total', ... });
observability.recordDuration({ metricName: 'preferences_update_duration_ms', ... });
```

Events должны писаться после успешного commit.

### Evaluation integration

Evaluation service должен вызывать observability после successful decision.

Примеры:

```ts
observability.recordNotificationDecision(...);
observability.incrementCounter({ metricName: 'notification_decision_total', ... });
observability.recordDuration({ metricName: 'notification_decision_duration_ms', ... });
```

Decision counters должны различать:

- `allow`;
- `deny`;
- `source`;
- `channel`.

### Errors integration

Global exception filter должен вызывать observability для service errors.

Примеры:

```ts
observability.recordServiceError(...);
observability.incrementCounter({ metricName: 'service_errors_total', ... });
```

Вызов должен быть non-blocking.

Если observability падает при записи error event, исходный API error response должен сохраниться.

### Auth integration

Basic Auth guard или errors integration должен писать auth failures.

Примеры:

```ts
observability.recordAuthFailure(...);
observability.incrementCounter({ metricName: 'auth_failures_total', ... });
observability.recordDuration({ metricName: 'basic_auth_guard_duration_ms', ... });
```

Credentials и raw auth headers писать нельзя.

## Production extension

После MVP stdout sink можно заменить или дополнить production sinks:

- ClickHouse для append-only events;
- Prometheus/OpenTelemetry для metrics;
- брокер сообщений для асинхронной доставки events;
- centralized logging platform.

Если будет выбран ClickHouse, можно вынести events в таблицы:

- `preference_change_events`;
- `notification_decision_events`;
- `service_error_events`;
- `metric_counters`;
- `metric_timers`.

Но эти таблицы не являются частью обязательного MVP.

## Что не входит в MVP

В MVP не нужно реализовывать:

- ClickHouse sink;
- Prometheus exporter;
- OpenTelemetry exporter;
- message broker sink;
- external log platform integration;
- alerting rules;
- dashboards;
- production tracing across services.

MVP должен оставить архитектурную возможность добавить эти sinks позже.
