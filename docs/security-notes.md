# Security Notes

Документ фиксирует security-ограничения текущего MVP Notification Preferences Service и направления развития после сдачи тестового задания.

## MVP-подход

Для MVP используется Basic Auth.

Причины:

- простая реализация;
- легко проверить через curl/Postman;
- достаточно для локальной разработки и тестового задания;
- не требует отдельного identity provider;
- не требует отдельной модели clients/scopes/permissions на этапе MVP.

Basic Auth является осознанным компромиссом.

Он не является полноценной production-схемой авторизации.

Вне локальной разработки Basic Auth должен использоваться только поверх HTTPS/TLS.

## Scope авторизации

Все публичные и включенные служебные HTTP endpoint-ы должны проходить Basic авторизацию через NestJS Guard.

За авторизацию отвечает:

```text
BasicAuthGuard
```

Guard должен быть применен глобально ко всем включенным endpoint-ам.

Публичные endpoint-ы:

```text
/api/...
```

Служебные endpoint-ы:

```text
/internal/...
```

Служебные endpoint-ы требуют Basic Auth только если они включены.

Если служебный endpoint выключен, он должен выглядеть как несуществующий ресурс и возвращать `404 Not Found`.

## Credentials

Credentials берутся только из env/config:

```text
BASIC_AUTH_USERNAME
BASIC_AUTH_PASSWORD
```

Правила:

- не хранить credentials в коде;
- не хранить credentials в test fixtures;
- не хранить credentials в README;
- не хранить credentials в документации;
- не коммитить credentials в репозиторий;
- не писать credentials в logs/events/metrics;
- не возвращать credentials в error response.

Если credentials отсутствуют или пустые, сервис считается неправильно сконфигурированным.

В этом случае клиенту возвращается безопасная ошибка:

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

Публичный ответ не должен раскрывать:

- какая именно env-переменная отсутствует;
- какие значения были сконфигурированы;
- username;
- password.

Для observability это должно считаться critical auth misconfiguration.

## Формат Basic Auth

Клиент передает credentials в HTTP header:

```text
Authorization: Basic base64(username:password)
```

Строка для кодирования:

```text
username:password
```

Пример для `username = service` и `password = secret`:

```text
service:secret
```

После Base64-кодирования:

```text
Authorization: Basic c2VydmljZTpzZWNyZXQ=
```

## Разбор Authorization header

`BasicAuthGuard` должен:

- требовать наличие `Authorization` header;
- сравнивать auth scheme `Basic` case-insensitive;
- требовать token после `Basic`;
- проверять, что token является валидным Base64;
- декодировать Base64;
- разделять decoded value по первому символу `:`;
- разрешать символ `:` внутри password;
- отклонять пустой username;
- отклонять пустой password;
- не логировать raw header;
- не логировать Base64 token;
- не логировать decoded credentials;
- не логировать username;
- не логировать password.

Примеры:

```text
Authorization: Basic <base64(username:password)>
```

Если password содержит `:`, split должен выполняться только по первому `:`.

Пример decoded value:

```text
service:sec:ret
```

Результат:

```text
username = service
password = sec:ret
```

## Проверка credentials

Сравнение credentials должно выполняться безопасно.

Требования:

- использовать constant-time comparison, например `crypto.timingSafeEqual`;
- перед сравнением привести значения к `Buffer`;
- безопасно обрабатывать строки разной длины;
- не раскрывать, username или password был неверным;
- все auth failures должны возвращать одинаковую публичную ошибку.

Публичная ошибка для auth failure:

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

Ответ `401` должен включать header:

```text
WWW-Authenticate: Basic realm="Notification Preferences Service"
```

Header должен возвращаться при:

- отсутствии credentials;
- malformed Authorization header;
- неверном username;
- неверном password.

## Observability context

Security-слой должен использовать существующий observability context.

`requestId`, `serviceId` и `correlationId` создаются в `ObservabilityMiddleware`.

`BasicAuthGuard` не должен:

- генерировать `requestId`;
- валидировать `X-Request-Id`;
- читать `X-Request-Id` напрямую;
- создавать отдельный request context.

Auth errors должны проходить через Errors module и получать `requestId` из observability context.

## Error response sanitization

Ошибка не должна раскрывать чувствительные или внутренние детали.

Запрещено отдавать клиенту:

- stack trace;
- raw SQL errors;
- raw exception messages для неожиданных ошибок;
- env values;
- connection strings;
- `Authorization` header;
- Base64 token;
- decoded Basic credentials;
- username;
- password;
- cookies;
- access tokens;
- refresh tokens;
- API keys;
- private keys.

Поле `error.details` можно использовать только для безопасных данных, например списка невалидных field paths.

Auth-related errors должны использовать:

```json
"details": null
```

или другой безопасный минимум, не раскрывающий credentials/header data.

## Internal endpoints

Служебные endpoint-ы нужны для local/test сценариев.

Основной endpoint MVP:

```text
POST /internal/:ecosystemCode/users
```

Он нужен для тестов и локальной проверки без подключения брокера сообщений.

В production-подходе пользователи должны попадать в сервис из событий user/profile service.

## Риски internal endpoints

Если internal endpoint доступен в production:

- клиент с валидными Basic credentials сможет создавать пользователей вручную;
- можно загрязнить локальную пользовательскую проекцию;
- можно создать расхождение с user/profile service;
- можно усложнить аудит источника пользовательских данных.

Поэтому internal endpoints должны быть отключены по умолчанию.

## ENABLE_INTERNAL_ENDPOINTS

Internal endpoints включаются через env/config:

```text
ENABLE_INTERNAL_ENDPOINTS=true
```

Default value:

```text
false
```

Правила:

- если flag выключен, internal endpoint возвращает `404 Not Found`;
- если flag выключен, сервис не должен создавать или обновлять данные;
- публичное сообщение `404` не должно раскрывать, что endpoint существует, но отключен;
- если flag включен, endpoint всё равно должен проходить Basic Auth;
- нельзя добавлять Basic Auth bypass для `/internal/...`.

## InternalEndpointGuard

Проверка доступности internal endpoint-ов должна быть реализована через отдельный NestJS Guard.

Рекомендуемое имя:

```text
InternalEndpointGuard
```

Guard отвечает только за доступность internal endpoint-ов.

Он должен:

- читать `ENABLE_INTERNAL_ENDPOINTS` из config layer;
- считать отсутствующее значение как `false`;
- возвращать `404 Not Found`, если endpoint выключен;
- не содержать Basic Auth logic;
- не содержать бизнес-логику создания пользователя;
- использовать `ErrorService.notFound(...)`;
- использовать стандартный error envelope;
- использовать `requestId` из observability context.

Рекомендуемый порядок:

```text
ObservabilityMiddleware
  -> InternalEndpointGuard
  -> BasicAuthGuard
  -> Controller
```

Требуемое поведение:

```text
ENABLE_INTERNAL_ENDPOINTS=false -> 404
ENABLE_INTERNAL_ENDPOINTS=true + no/invalid credentials -> 401
ENABLE_INTERNAL_ENDPOINTS=true + valid credentials -> controller
```

Если в NestJS используется глобальный `APP_GUARD` для Basic Auth, порядок guard-ов должен быть настроен так, чтобы disabled internal endpoint не раскрывался через `401`.

Нельзя молча менять поведение disabled internal endpoint-а на `401`, если документация не обновлена.

## Brute force и rate limiting

В MVP brute-force защита может быть ограничена observability и алертами.

Минимум для MVP:

- писать auth failures в observability;
- считать `auth_failures_total`;
- не раскрывать в ошибке, что именно неверно: username или password;
- не логировать credentials;
- не логировать raw Authorization header.

После MVP:

- добавить rate limiting на gateway или application уровне;
- добавить throttling по IP/client id;
- добавить временные блокировки при большом числе ошибок;
- добавить отдельные credentials на клиента;
- добавить alerting на всплески `auth_failures_total`.

## Observability для security events

Security-related events должны писаться через observability layer.

### Auth failure

Для auth failure:

```text
eventType = service_error
errorCode = unauthorized
component = auth
operation = basic_auth
severity = warning
```

Рекомендуемый counter:

```text
auth_failures_total
```

Запрещено писать:

- username;
- password;
- Authorization header;
- Base64 token;
- decoded credentials.

### Auth misconfiguration

Для auth misconfiguration:

```text
eventType = service_error
errorCode = basic_auth_misconfigured
component = auth
operation = basic_auth
severity = critical
```

Запрещено писать:

- env values;
- configured username;
- configured password;
- название отсутствующей переменной, если это раскрывает внутренние детали публичному клиенту.

Во внутреннем логировании можно указать безопасный operational message без секретов.

### Disabled internal endpoint

Для disabled internal endpoint можно писать безопасное internal event, если это не раскрывает endpoint клиенту.

Публичный ответ остается:

```text
404 Not Found
```

Событие не должно содержать credentials или raw headers.

## Безопасность logs/events/metrics

Запрещено писать в logs, observability events, metrics labels и output:

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
- stack trace в публичном API response.

Stack trace допустим только во внутренних `service_error` events для unexpected exceptions и только после проверки, что он не раскрывает secrets.

Metric labels должны быть low-cardinality и безопасными.

Не использовать в labels:

- raw `userId`;
- raw `requestId`;
- raw `correlationId`;
- raw datetime;
- raw error message;
- raw URL с query string.

## DTO validation security

Все DTO должны использовать strict validation.

Требования:

- лишние поля в request body отклоняются;
- лишние nested fields отклоняются;
- validation error возвращает `400 validation_error`;
- validation details могут содержать безопасные field paths;
- validation details не должны содержать raw request body.

Это снижает риск:

- accidental data persistence;
- unexpected input processing;
- leakage of sensitive payloads in error responses.

## Datetime validation security

Evaluation endpoint должен принимать только datetime как конкретный момент времени с timezone offset.

Требования:

- naive/local datetime без timezone offset отклоняется;
- невалидный datetime отклоняется;
- datetime в прошлом отклоняется;
- тесты должны генерировать future datetime динамически.

Это снижает риск неоднозначной интерпретации времени и ошибок при timezone conversion.

## Production improvements

После сдачи тестового задания Basic Auth стоит заменить или расширить более гибкой схемой авторизации.

Возможные варианты:

- API keys per client;
- HMAC request signing;
- OAuth2 Client Credentials;
- JWT access tokens;
- mTLS между сервисами;
- интеграция с API Gateway.

Рекомендуемое направление:

1. Ввести отдельную сущность service client.
2. Выдавать отдельные credentials каждому продуктовому модулю.
3. Добавить scopes/permissions:
   - `preferences:read`;
   - `preferences:write`;
   - `notifications:evaluate`;
   - `internal:users:create`.
4. Добавить ротацию credentials.
5. Добавить audit по client id.
6. Закрыть internal endpoints отдельным scope или полностью убрать их из production.
7. Добавить rate limiting и brute-force protection.
8. Добавить network-level restrictions для internal routes.
9. Добавить structured security alerting.

## Итоговое решение для MVP

Basic Auth остается осознанным компромиссом для тестового задания.

При сдаче проекта нужно явно указать в README:

- Basic Auth используется только как MVP-решение;
- вне local development Basic Auth должен использоваться только через HTTPS/TLS;
- credentials берутся только из env/secrets;
- для production нужна более гибкая схема авторизации;
- internal endpoints должны быть отключены или ограничены вне local/test окружения;
- auth failures логируются безопасно;
- secrets и credentials не попадают в logs/events/error details.
