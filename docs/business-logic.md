# Бизнес-логика и основная модель данных

Документ описывает доменную модель Notification Preferences Service, основную PostgreSQL-схему и ключевые бизнес-правила MVP.

Сервис определяет, можно ли отправить пользователю уведомление через конкретный канал в конкретный момент времени, с учетом:

- дефолтных настроек;
- индивидуальных настроек пользователя;
- глобальных политик;
- quiet hours в таймзоне пользователя;
- идемпотентности операций изменения настроек.

Основные сущности хранятся в PostgreSQL, потому что это транзакционное состояние сервиса: настройки должны обновляться консистентно, поддерживать ограничения целостности и FK-связи.

## Source of truth

Для реализации используются следующие документы:

1. `docs/openapi.yaml` — источник истины для HTTP API contract.
2. `docs/business-logic.md` — источник истины для бизнес-правил и модели данных.
3. `docs/security-notes.md` — источник истины для security-ограничений.
4. `docs/observability.md` — источник истины для observability, telemetry и request correlation.

Если между документами возникает конфликт, агент должен остановиться и явно описать расхождение.

## Observability context и request correlation

В сервисе должен быть единый observability context для каждого HTTP-запроса.

Контекст содержит:

- `requestId`;
- `serviceId`;
- `correlationId`, если он передан клиентом.

За создание и хранение этого контекста отвечает `ObservabilityMiddleware`.

`ObservabilityMiddleware` должен:

- читать `X-Request-Id` из HTTP headers;
- валидировать входящий `X-Request-Id`;
- генерировать новый `requestId`, если header отсутствует или невалиден;
- читать `X-Correlation-Id`, если он передан и валиден;
- читать `SERVICE_ID` из конфигурации;
- использовать `notification-preferences-service` как значение `serviceId` по умолчанию;
- сохранять `requestId`, `serviceId`, `correlationId` в контекст, доступный controller/service/guard/filter слоям;
- добавлять `X-Request-Id` в response headers;
- измерять длительность HTTP-запроса для технической telemetry.

Формат генерируемого `requestId`:

```text
req_<unix_epoch_ns>_<random_suffix>
```

Пример:

```text
req_1779604200123456789_a3f91c
```

`requestId`, `serviceId` и `correlationId` являются только correlation metadata.

Их нельзя использовать для принятия бизнес-решений.

Errors module, Basic Auth guard, domain services и observability events должны использовать уже существующий observability context и не должны генерировать собственный `requestId`.

## Авторизация

Для MVP все публичные и включенные служебные HTTP endpoint-ы должны проходить Basic авторизацию.

Basic Auth является MVP-компромиссом для тестового задания, а не production-ready моделью доступа.

Вне локальной разработки Basic Auth должен использоваться только поверх HTTPS.

Требования:

- авторизация обязательна для публичных и включенных служебных endpoint-ов;
- реализация должна быть сделана через NestJS Guard;
- credentials берутся из переменных окружения:
  - `BASIC_AUTH_USERNAME`;
  - `BASIC_AUTH_PASSWORD`;
- credentials не должны быть захардкожены в коде, fixtures, документации или README;
- клиент должен передавать credentials в HTTP header `Authorization`;
- формат header:

```text
Authorization: Basic base64(username:password)
```

Строка для кодирования формируется как:

```text
username:password
```

Пример для `username = service` и `password = secret`:

```text
service:secret
```

После Base64-кодирования клиент отправляет:

```text
Authorization: Basic c2VydmljZTpzZWNyZXQ=
```

Guard должен:

- прочитать `Authorization` header;
- сравнить auth scheme `Basic` case-insensitive;
- проверить наличие token после `Basic`;
- проверить, что token является валидным Base64;
- декодировать Base64-значение;
- разделить декодированное значение по первому символу `:`;
- разрешать символ `:` внутри password;
- отклонять пустой username;
- отклонять пустой password;
- сравнить username/password со значениями из config/env;
- выполнять сравнение credentials безопасно, например через constant-time comparison;
- не раскрывать клиенту, какая именно часть credentials неверна;
- не логировать raw `Authorization` header, Base64 token, decoded credentials, username или password.

Если credentials отсутствуют или некорректны, сервис возвращает:

```text
401 Unauthorized
```

Ответ `401` должен включать header:

```text
WWW-Authenticate: Basic realm="Notification Preferences Service"
```

Публичное тело ошибки:

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

Если env credentials не заданы или пустые, сервис считается неправильно сконфигурированным.

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

Подробности misconfiguration не должны попадать в публичный response.

## Служебные endpoint-ы

Служебные endpoint-ы нужны для локальной проверки, тестов и controlled operational use.

Endpoint создания пользователей:

```text
POST /internal/:ecosystemCode/users
```

Он включается env-флагом:

```text
ENABLE_INTERNAL_ENDPOINTS=true
```

Правила:

- значение по умолчанию: `false`;
- если флаг выключен, endpoint должен возвращать `404 Not Found`;
- при выключенном флаге сервис не должен создавать или обновлять пользователя;
- публичное сообщение `404` не должно раскрывать, что endpoint существует, но отключен;
- если флаг включен, endpoint все равно должен проходить Basic авторизацию;
- в production-подходе этот endpoint должен быть выключен или строго ограничен;
- в production-подходе пользователи должны создаваться или обновляться из событий user/profile service.

Проверка доступности служебного endpoint-а должна быть реализована через отдельный NestJS Guard.

Рекомендуемое имя:

```text
InternalEndpointGuard
```

`InternalEndpointGuard` отвечает только за проверку `ENABLE_INTERNAL_ENDPOINTS`.

Он должен:

- читать `ENABLE_INTERNAL_ENDPOINTS` из config layer;
- считать отсутствующее значение как `false`;
- пропускать запрос только если `ENABLE_INTERNAL_ENDPOINTS=true`;
- возвращать `404 Not Found`, если internal endpoints выключены;
- не содержать Basic Auth logic;
- не содержать бизнес-логику создания пользователя;
- использовать стандартный error envelope через Errors module;
- использовать `requestId` из observability context.

Рекомендуемый порядок обработки:

```text
ObservabilityMiddleware
  -> InternalEndpointGuard
  -> BasicAuthGuard
  -> Controller
```

Если в NestJS setup используется глобальный `APP_GUARD` для Basic Auth, реализация должна явно сохранить требуемое поведение:

- `ENABLE_INTERNAL_ENDPOINTS=false` -> `404`;
- `ENABLE_INTERNAL_ENDPOINTS=true` без credentials -> `401`;
- `ENABLE_INTERNAL_ENDPOINTS=true` с корректными credentials -> controller.

Нельзя молча менять поведение disabled internal endpoint-а на `401`, если документация не обновлена.

## API response envelope

Все успешные HTTP responses должны иметь envelope:

```json
{
  "data": {},
  "requestId": "req_1779604200123456789_a3f91c"
}
```

Все error responses должны иметь envelope:

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

`requestId` берется из observability context.

Controller и service слои не должны вручную собирать error response.

Все ошибки должны проходить через Errors module.

## Валидация HTTP-запросов

Все DTO должны использовать strict validation.

Правила:

- path params должны валидироваться;
- request body должен валидироваться;
- nested fields должны валидироваться;
- неизвестные поля должны отклоняться;
- request body с лишними полями должен возвращать `400 validation_error`;
- response с ошибкой может содержать безопасный список невалидных field paths;
- нельзя возвращать исходный request body целиком в `error.details`.

Пример безопасных validation details:

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

В `error.details` запрещено добавлять:

- headers;
- `Authorization`;
- cookies;
- Basic Auth credentials;
- decoded credentials;
- env values;
- connection strings;
- raw SQL errors;
- stack traces;
- raw request body.

## users

Локальная проекция пользователя внутри Notification Preferences Service.

В микросервисной архитектуре пользователи создаются или обновляются по событиям из брокера сообщений, которые публикует user/profile service.

Этот сервис не владеет полным профилем пользователя, но хранит минимальные данные, необходимые для привязки настроек уведомлений к известному пользователю.

Для тестов и локальной проверки предоставляется служебный API endpoint для заведения пользователей вручную.

Сервис использует собственный внутренний `id` для связей между таблицами, а внешнюю идентичность хранит как пару:

```text
ecosystem_code + external_user_id
```

Это защищает от коллизий, когда сервис подключен к нескольким экосистемам, где id пользователей могут совпадать.

`userId` из API соответствует `users.external_user_id`.

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Локальный id пользователя внутри сервиса. |
| `ecosystem_code` | `varchar(64)` | not null | Код экосистемы или tenant-источника. |
| `external_user_id` | `varchar(128)` | not null | Id пользователя во внешней системе. |
| `region` | `varchar(32)` | nullable | Последний известный регион пользователя из user/profile service. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Ограничения:

```text
unique(ecosystem_code, external_user_id)
```

Индексы:

```text
users_external_identity_idx on users(ecosystem_code, external_user_id)
users_region_idx on users(region)
```

### Идемпотентность создания пользователя

Операция создания/обновления локальной пользовательской проекции должна быть идемпотентной по паре:

```text
ecosystemCode + userId
```

Правила:

- если пользователя нет, создать запись;
- если пользователь уже есть и payload совпадает, вернуть существующее итоговое состояние;
- если пользователь уже есть и передан новый `region`, обновить `region`;
- если `region` не передан, не затирать существующий `region`;
- если `region` передан как `null`, можно очистить `region`, если такая семантика реализована;
- повторный запрос с тем же payload должен оставлять базу в одном и том же итоговом состоянии.

## notification_types

Справочник типов уведомлений.

Примеры:

- `marketing`;
- `transactional`;
- `security`;
- `order_status`.

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Внутренний id типа уведомления. |
| `code` | `varchar(64)` | not null, unique | Стабильный машинный код типа уведомления. |
| `name` | `varchar(128)` | not null | Человекочитаемое название. |
| `description` | `text` | nullable | Дополнительное описание. |
| `respects_quiet_hours` | `boolean` | not null | Должен ли тип уведомления блокироваться во время quiet hours. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Ограничения:

```text
unique(code)
```

Бизнес-правило:

- маркетинговые и другие некритичные уведомления должны иметь `respects_quiet_hours = true`;
- транзакционные и security-уведомления могут иметь `respects_quiet_hours = false`, чтобы оставаться разрешенными во время quiet hours.

## channels

Справочник каналов доставки уведомлений.

Примеры:

- `email`;
- `sms`;
- `push`;
- `messenger`.

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Внутренний id канала. |
| `code` | `varchar(64)` | not null, unique | Стабильный машинный код канала. |
| `name` | `varchar(128)` | not null | Человекочитаемое название. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Ограничения:

```text
unique(code)
```

## default_preferences

Дефолтные настройки, которые используются, если у пользователя нет индивидуальной настройки для пары:

```text
notification type + channel
```

Таблица описывает singleton-набор дефолтных настроек для всего сервиса.

В MVP она не хранит несколько профилей дефолтов или версий.

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Внутренний id настройки. |
| `notification_type_id` | `uuid` | not null, foreign key | Ссылка на `notification_types.id`. |
| `channel_id` | `uuid` | not null, foreign key | Ссылка на `channels.id`. |
| `allowed` | `boolean` | not null | Разрешены ли уведомления по умолчанию. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Ограничения:

```text
unique(notification_type_id, channel_id)
```

Это гарантирует, что внутри singleton-набора дефолтов существует ровно одно значение для каждой пары `notification type + channel`.

Не добавлять флаг `enabled` в MVP.

## user_preferences

Индивидуальные настройки пользователя для пар:

```text
notification type + channel
```

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Внутренний id настройки. |
| `user_id` | `uuid` | not null, foreign key | Ссылка на `users.id`. |
| `notification_type_id` | `uuid` | not null, foreign key | Ссылка на `notification_types.id`. |
| `channel_id` | `uuid` | not null, foreign key | Ссылка на `channels.id`. |
| `allowed` | `boolean` | not null | Разрешил ли пользователь этот тип уведомления через этот канал. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Ограничения:

```text
unique(user_id, notification_type_id, channel_id)
```

Это позволяет реализовать изменение настроек как идемпотентный upsert.

Индексы:

```text
user_preferences_user_id_idx on user_preferences(user_id)
user_preferences_lookup_idx on user_preferences(user_id, notification_type_id, channel_id)
```

## quiet_hours

Тихие часы пользователя в конкретной IANA-таймзоне.

В MVP у одного пользователя может быть только одна настройка quiet hours.

Связь с пользователем:

```text
quiet_hours.user_id -> users.id
```

Связь с `user_preferences` не прямая: обе таблицы относятся к одному пользователю через `users.id`.

При проверке отправки сервис сначала находит пользователя, затем отдельно читает его quiet hours и preference для пары `notification type + channel`.

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Внутренний id настройки quiet hours. |
| `user_id` | `uuid` | not null, unique, foreign key | Ссылка на `users.id`. |
| `start_time` | `time` | not null | Локальное время начала quiet hours. |
| `end_time` | `time` | not null | Локальное время окончания quiet hours. |
| `timezone` | `varchar(64)` | not null | IANA-таймзона, например `Asia/Yekaterinburg`. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Ограничения:

```text
unique(user_id)
check(start_time != end_time)
```

Бизнес-правила:

- `start_time < end_time` означает интервал внутри одного дня, например `13:00-15:00`;
- `start_time > end_time` означает интервал с переходом через полночь, например `22:00-08:00`;
- `start_time = end_time` нужно отклонять на уровне валидации и дополнительно защищать constraint-ом в БД;
- timezone должна быть валидной IANA timezone.

Индексы:

```text
quiet_hours_user_id_idx on quiet_hours(user_id)
```

## global_policies

Глобальные политики разрешения или запрета по типу уведомления, каналу и региону.

В MVP evaluation использует подходящие global `deny` policies.

`allow` policies допускаются схемой для future compatibility, но не должны менять MVP decision algorithm, пока бизнес-логика и OpenAPI явно не обновлены.

Пример MVP policy:

```text
marketing + sms + EU = deny
```

| Колонка | Тип | Ограничения | Описание |
| --- | --- | --- | --- |
| `id` | `uuid` | primary key | Внутренний id политики. |
| `notification_type_id` | `uuid` | nullable, foreign key | Ссылка на `notification_types.id`. `null` означает любой тип уведомления. |
| `channel_id` | `uuid` | nullable, foreign key | Ссылка на `channels.id`. `null` означает любой канал. |
| `region` | `varchar(32)` | nullable | Код региона. `null` означает любой регион. |
| `effect` | `varchar(16)` | not null | Эффект политики: `allow` или `deny`. |
| `reason` | `text` | not null | Человекочитаемое/audit-объяснение политики. |
| `priority` | `integer` | not null | Приоритет политики. Политики с большим приоритетом проверяются раньше. |
| `created_at` | `timestamptz` | not null | Дата создания записи. |
| `updated_at` | `timestamptz` | not null | Дата последнего обновления записи. |

Индексы:

```text
global_policies_lookup_idx on global_policies(notification_type_id, channel_id, region)
global_policies_priority_idx on global_policies(priority desc)
```

Валидация:

```text
effect in ('allow', 'deny')
priority >= 0
notification_type_id is not null or channel_id is not null or region is not null
```

Правила wildcard:

- `notification_type_id = null` означает любой тип уведомления;
- `channel_id = null` означает любой канал;
- `region = null` означает любой регион.

Если найдено несколько подходящих deny-политик:

- выбирается политика с наибольшим `priority`;
- при равном priority используется стабильная сортировка, например `created_at asc`, затем `id asc`.

`global_policies.reason` можно использовать для audit/logging, но публичный `reason` в evaluation response должен быть стабильным enum из OpenAPI.

## Получение preferences

Endpoint:

```text
GET /api/:ecosystemCode/users/:userId/preferences
```

Должен вернуть:

- `ecosystemCode`;
- `userId`;
- массив effective preferences;
- `quietHours`, если настроены;
- `quietHours: null`, если не настроены.

Effective preferences строятся по singleton-набору `default_preferences`.

Правила:

- если для пары `notification type + channel` есть `user_preferences`, оно переопределяет default;
- если пользовательской настройки нет, используется default preference;
- `source = user_preference` для индивидуального значения;
- `source = default_preference` для дефолтного значения;
- не включать пары, для которых нет default preference, если OpenAPI/бизнес-док не требуют иного.

Если пользователь не найден, вернуть `404 not_found`.

## Изменение preferences

Endpoint:

```text
POST /api/:ecosystemCode/users/:userId/preferences
```

Может обновлять:

- `user_preferences`;
- `quiet_hours`;
- оба блока одновременно.

Request body должен содержать хотя бы одно поле:

- `preferences`;
- `quietHours`.

Если body содержит только `preferences`, quiet hours не меняются.

Если body содержит только `quietHours`, user preferences не меняются.

Если body содержит и `preferences`, и `quietHours`, обновление должно быть атомарным в одной database transaction.

Если одна часть обновления падает, вторая часть не должна сохраняться.

### Upsert user_preferences

Для `user_preferences` использовать upsert по:

```text
user_id + notification_type_id + channel_id
```

Правила:

- повторный запрос с тем же payload не создает дубль;
- если `allowed` меняется, обновить запись и `updated_at`;
- если `allowed` не меняется, итоговое состояние остается тем же;
- не создавать пользователя автоматически;
- не создавать notification types/channels на лету.

### Upsert quiet_hours

Для `quiet_hours` использовать upsert по:

```text
user_id
```

Правила:

- повторный запрос с тем же payload не создает дубль;
- timezone хранить как IANA string;
- `start_time` и `end_time` хранить как local time;
- `startTime = endTime` отклонять;
- интервал через полночь разрешен.

## Проверка возможности отправки уведомления

Endpoint:

```text
POST /api/:ecosystemCode/evaluate
```

Evaluation domain только читает данные и принимает решение.

Он не должен изменять:

- users;
- notification_types;
- channels;
- default_preferences;
- user_preferences;
- quiet_hours;
- global_policies.

Evaluation не должен создавать недостающие данные на лету.

## Валидация datetime

Перед применением бизнес-правил сервис должен провалидировать входной `datetime`.

Требования:

- значение должно быть конкретным моментом времени с timezone offset;
- naive/local datetime без timezone offset не принимается;
- значение не должно быть в прошлом относительно текущего времени сервиса;
- запрос с прошлым или невалидным `datetime` должен возвращать `400`.

Валидные примеры:

```text
2027-05-21T21:30:00Z
2027-05-21T21:30:00+03:00
```

Невалидные примеры:

```text
2027-05-21T21:30:00
2027-05-21
not-a-date
```

Тесты должны генерировать future datetime динамически, а не использовать фиксированную дату, которая со временем станет прошлой.

## Порядок принятия решения

При проверке возможности отправки уведомления сервис должен применять правила строго в таком порядке:

1. Найти подходящие global deny policies.
2. Если тип уведомления имеет `respects_quiet_hours = true`, проверить quiet hours пользователя, предварительно переведя входной `datetime` в timezone из настройки quiet hours.
3. Найти индивидуальную настройку пользователя для запрошенных notification type и channel.
4. Если индивидуальной настройки нет, взять default preference для запрошенных notification type и channel.
5. Если нет ни индивидуальной, ни дефолтной настройки, вернуть fallback deny.

Порядок важен: первый сработавший шаг останавливает evaluation.

## Decision reasons и error codes

Business decision reasons и API error codes должны быть разделены.

Successful evaluation response может содержать только бизнес-решение:

```json
{
  "data": {
    "decision": "deny",
    "reason": "blocked_by_user_preference",
    "source": "user_preference"
  },
  "requestId": "req_1779604200123456789_a3f91c"
}
```

Возможные `source`:

- `global_policy`;
- `quiet_hours`;
- `user_preference`;
- `default_preference`;
- `fallback`.

Возможные business `reason`:

- `blocked_by_global_policy`;
- `blocked_by_quiet_hours`;
- `allowed_by_user_preference`;
- `blocked_by_user_preference`;
- `allowed_by_default_preference`;
- `blocked_by_default_preference`;
- `fallback_deny`.

Отсутствующие сущности не являются successful `deny` decision.

Они должны возвращаться как API errors:

- неизвестный user -> `404 not_found`;
- неизвестный notification type -> `404 not_found`;
- неизвестный channel -> `404 not_found`.

Нельзя возвращать:

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

## Global policy decision

Проверять только подходящие `deny` policies.

Policy match:

- `notification_type_id` совпадает с запрошенным типом или `null`;
- `channel_id` совпадает с запрошенным каналом или `null`;
- `region` совпадает с request `region` или `null`;
- `effect = deny`.

Результат при блокировке:

```json
{
  "decision": "deny",
  "reason": "blocked_by_global_policy",
  "source": "global_policy"
}
```

Global deny policy имеет приоритет выше user/default preferences.

## Quiet hours decision

Quiet hours применяются только если:

- у пользователя есть запись `quiet_hours`;
- notification type имеет `respects_quiet_hours = true`;
- входной `datetime` после перевода в timezone пользователя попадает в интервал quiet hours.

Правила:

- `datetime` приходит как instant;
- перед сравнением instant переводится в IANA timezone из `quiet_hours.timezone`;
- сравнивается только local time;
- `start_time < end_time` означает интервал внутри одного дня;
- `start_time > end_time` означает интервал через полночь;
- если `start_time = end_time` обнаружен в БД, это configuration/data integrity error.

Результат при блокировке:

```json
{
  "decision": "deny",
  "reason": "blocked_by_quiet_hours",
  "source": "quiet_hours"
}
```

Если notification type имеет `respects_quiet_hours = false`, quiet hours полностью пропускаются.

## User preference decision

Найти `user_preferences` по:

```text
user_id + notification_type_id + channel_id
```

Если запись найдена:

- `allowed = true` -> `allow`, `reason = allowed_by_user_preference`, `source = user_preference`;
- `allowed = false` -> `deny`, `reason = blocked_by_user_preference`, `source = user_preference`.

User preference переопределяет default preference.

## Default preference decision

Если user preference не найден, найти `default_preferences` по:

```text
notification_type_id + channel_id
```

Если запись найдена:

- `allowed = true` -> `allow`, `reason = allowed_by_default_preference`, `source = default_preference`;
- `allowed = false` -> `deny`, `reason = blocked_by_default_preference`, `source = default_preference`.

## Fallback deny

Если нет ни user preference, ни default preference:

```json
{
  "decision": "deny",
  "reason": "fallback_deny",
  "source": "fallback"
}
```

Fallback deny нужен, чтобы сервис не разрешал отправку при неполной конфигурации.

## Идемпотентность

Операции изменения настроек должны быть идемпотентными.

Для `user_preferences` использовать upsert по:

```text
user_id + notification_type_id + channel_id
```

Для `quiet_hours` использовать upsert по:

```text
user_id
```

Для internal user API использовать upsert по:

```text
ecosystem_code + external_user_id
```

Повторные запросы с одинаковым payload должны оставлять базу в одном и том же итоговом состоянии.

## Observability events

MVP должен поддерживать structured observability events, counters и timers.

Default sink:

```text
stdout / application logger
```

Observability не является source of truth.

Если observability sink падает:

- основная операция не должна откатываться;
- API response не должен ломаться;
- не должно быть retry-loop, который задерживает пользовательский запрос.

Все events внутри HTTP request должны содержать:

- `requestId`;
- `serviceId`;
- `correlationId`, если есть.

### Preference events

После успешного изменения user preferences:

```text
preference_changed
```

После успешного изменения quiet hours:

```text
quiet_hours_changed
```

Events должны создаваться только после успешного commit.

Нельзя писать successful change event для rolled-back операции.

### Evaluation events

После успешной evaluation:

```text
notification_decision
```

Event должен содержать:

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

Validation errors и `404 not_found` не являются successful notification decisions.

### Service error events

Ошибки, на которые потенциально нужно реагировать:

```text
service_error
```

Примеры:

- unexpected exceptions;
- PostgreSQL errors;
- Basic Auth failures;
- Basic Auth misconfiguration;
- observability sink errors.

В events, metrics labels и logs запрещено писать:

- `Authorization` header;
- Basic Auth username/password;
- decoded credentials;
- cookies;
- access tokens;
- env values;
- connection strings;
- raw SQL errors;
- raw request body;
- raw exception objects;
- full request headers.

## Metrics

MVP может представлять metrics как structured events.

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

Рекомендуемые timers:

- `preferences_update_duration_ms`;
- `notification_decision_duration_ms`;
- `basic_auth_guard_duration_ms`;
- `postgres_query_duration_ms`;
- `http_request_duration_ms`.

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

## Seed data

Production/base seed должен содержать справочники и дефолтные preferences.

Минимальный набор `notification_types`:

| code | respects_quiet_hours |
| --- | --- |
| `marketing` | `true` |
| `transactional` | `false` |
| `security` | `false` |
| `order_status` | `false` |

Минимальный набор `channels`:

- `email`;
- `sms`;
- `push`;
- `messenger`.

Минимальные default preferences:

| Notification type | Channel | Allowed |
| --- | --- | --- |
| `transactional` | `email` | `true` |
| `security` | `email` | `true` |
| `order_status` | `push` | `true` |
| `marketing` | `email` | `false` |
| `marketing` | `sms` | `false` |
| `marketing` | `push` | `false` |

Development/test seed может добавлять тестовую global policy:

| Notification type | Channel | Region | Effect | Reason | Priority |
| --- | --- | --- | --- | --- | --- |
| `marketing` | `sms` | `EU` | `deny` | `blocked_by_global_policy` | `100` |

Seed операции должны быть идемпотентными.

`db:seed` не должен создавать тестовых пользователей или тестовые global policies.

`db:seed:test` может применять base seed и затем development/test seed.

## Таблицы MVP

PostgreSQL:

- `users`;
- `notification_types`;
- `channels`;
- `default_preferences`;
- `user_preferences`;
- `quiet_hours`;
- `global_policies`.
