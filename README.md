# Notification Preferences Service

Централизованный сервис пользовательских настроек уведомлений и проверки возможности отправки уведомления.

Сервис отвечает на вопрос:

```text
Можно ли отправить пользователю такое уведомление по этому каналу в это время?
```

Поддерживается:

- локальная проекция пользователей;
- дефолтные настройки уведомлений;
- пользовательские переопределения настроек;
- quiet hours в IANA timezone пользователя;
- глобальные deny-политики;
- read-only evaluation;
- request/correlation id и структурированные observability-события;
- Basic Auth для включённых HTTP endpoint'ов.

## Стек

- TypeScript
- Node.js 24.x
- NestJS
- PostgreSQL
- Drizzle ORM
- Basic Auth
- OpenAPI-контракт: [docs/openapi.yaml](docs/openapi.yaml)
- observability-модуль со stdout / application logger sink

## Объём MVP

Реализовано:

- `POST /internal/:ecosystemCode/users`
- `GET /api/:ecosystemCode/users/:userId/preferences`
- `POST /api/:ecosystemCode/users/:userId/preferences`
- `POST /api/:ecosystemCode/evaluate`
- PostgreSQL schema и seed-скрипты
- стандартные success/error envelopes с `requestId`
- Basic Auth guard
- observability context, events, counters и timers

Не входит в MVP:

- OAuth, JWT, mTLS, scopes и роли
- rate limiting и защита от brute force
- синхронизация пользователей через брокер
- API управления глобальными политиками
- production observability sink
- admin UI
- несколько профилей дефолтных настроек

## Быстрый запуск через Docker

Подготовить `.env`:

```bash
cp .env.example .env
```

Для локального запуска удобно включить internal endpoint'ы и задать тестовые Basic Auth credentials:

```env
ENABLE_INTERNAL_ENDPOINTS=true
BASIC_AUTH_USERNAME=local
BASIC_AUTH_PASSWORD=local
```

Запустить приложение и PostgreSQL:

```bash
docker compose up --build
```

Контейнер приложения перед стартом может выполнять миграции и seeds в зависимости от переменных окружения:

```bash
pnpm run drizzle:migrate
node dist/database/seeds/base.seed.js
node dist/database/seeds/test.seed.js
```

После старта API доступен на `http://localhost:${APP_PORT:-3000}`.

Поведение startup-команд можно переопределить переменными:

| Переменная | Значение по умолчанию | Описание |
| --- | --- | --- |
| `RUN_MIGRATIONS` | `true` | Выполнять `drizzle:migrate` перед стартом приложения. |
| `RUN_SEEDS` | `true` | Выполнять базовые seeds перед стартом приложения. |
| `RUN_TEST_SEEDS` | `true` | Выполнять test seeds перед стартом приложения. |

Например, запустить без test seeds:

```bash
RUN_TEST_SEEDS=false docker compose up --build
```

## Локальный запуск без контейнера приложения

Требования:

- Node.js 24.x
- pnpm 8.x
- Docker / Docker Compose для PostgreSQL

Установить зависимости:

```bash
pnpm install
```

Подготовить `.env`:

```bash
cp .env.example .env
```

Для запуска приложения с хоста `DATABASE_URL` должен указывать на localhost:

```env
DATABASE_URL=postgresql://notification_preferences:notification_preferences@localhost:5432/notification_preferences
ENABLE_INTERNAL_ENDPOINTS=true
BASIC_AUTH_USERNAME=local
BASIC_AUTH_PASSWORD=local
```

Запустить PostgreSQL:

```bash
docker compose up -d postgres
```

Накатить миграции и seeds:

```bash
pnpm run drizzle:migrate
pnpm run db:seed
pnpm run db:seed:test
```

Запустить приложение:

```bash
pnpm run start:dev
```

Production-like запуск после build:

```bash
pnpm run build
pnpm run start:prod
```

## Переменные окружения

| Переменная | Обязательная | Описание |
| --- | --- | --- |
| `APP_PORT` | нет | HTTP-порт приложения, по умолчанию `3000`. |
| `NODE_ENV` | нет | Runtime environment. |
| `SERVICE_ID` | нет | Service id для observability, по умолчанию `notification-preferences-service`. |
| `DATABASE_URL` | да | PostgreSQL connection string. В Docker Compose переопределяется на host `postgres`. |
| `POSTGRES_HOST` | нет | Helper-переменная для локального PostgreSQL. |
| `POSTGRES_PORT` | нет | Helper-переменная для порта PostgreSQL. |
| `POSTGRES_USER` | нет | Пользователь PostgreSQL. |
| `POSTGRES_PASSWORD` | нет | Пароль PostgreSQL. |
| `POSTGRES_DB` | нет | Имя базы PostgreSQL. |
| `BASIC_AUTH_USERNAME` | да | Basic Auth username. Не коммитить реальные секреты. |
| `BASIC_AUTH_PASSWORD` | да | Basic Auth password. Не коммитить реальные секреты. |
| `ENABLE_INTERNAL_ENDPOINTS` | нет | Включает `/internal/...` endpoint'ы только при значении `true`; по умолчанию `false`. |
| `RUN_MIGRATIONS` | нет | Docker startup: запускать миграции перед стартом. |
| `RUN_SEEDS` | нет | Docker startup: запускать базовые seeds перед стартом. |
| `RUN_TEST_SEEDS` | нет | Docker startup: запускать test seeds перед стартом. |

Вне локальной разработки Basic Auth должен использоваться только поверх HTTPS/TLS.

## Seeds

Базовый seed:

```bash
pnpm run db:seed
```

Идемпотентно добавляет:

- notification types: `marketing`, `transactional`, `security`, `order_status`;
- channels: `email`, `sms`, `push`, `messenger`;
- default preferences для основных пар notification type / channel.

Test seed:

```bash
pnpm run db:seed:test
```

Добавляет базовый seed и тестовую глобальную deny-политику:

```text
marketing + sms + EU = deny, priority = 100
```

## Тесты

Запустить все доступные тесты:

```bash
pnpm test
```

Проверить TypeScript build:

```bash
pnpm run build
```

DB-backed проверка при запущенном PostgreSQL:

```bash
pnpm run drizzle:migrate
pnpm run db:seed
pnpm run db:seed:test
```

Текущий test suite использует встроенный Node.js test runner и покрывает доменную логику, guards, validation, envelopes, observability и readiness-документацию. Скрипта `test:e2e` пока нет.

## API

Все включённые endpoint'ы требуют Basic Auth.

Реализованные endpoint'ы:

- `POST /internal/:ecosystemCode/users`
- `GET /api/:ecosystemCode/users/:userId/preferences`
- `POST /api/:ecosystemCode/users/:userId/preferences`
- `POST /api/:ecosystemCode/evaluate`

Базовая форма авторизации для curl:

```bash
-u "$BASIC_AUTH_USERNAME:$BASIC_AUTH_PASSWORD"
```

Для локальной проверки удобно задать переменные:

```bash
export BASE_URL="http://localhost:3000"
export BASIC_AUTH_USERNAME="local"
export BASIC_AUTH_PASSWORD="local"
export AUTH="-u ${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}"
```



Для генерации Basic Auth вручную:

```bash
printf 'local:local' | base64
```

## Ручная проверка через curl

Curl-сценарии полезны для проверки API из терминала или CI. Для локальной ручной проверки в WebStorm предпочтительнее использовать блок `requests.http` выше.

Перед выполнением curl-сценариев убедиться, что:

1. PostgreSQL запущен.
2. Миграции применены.
3. `db:seed` и `db:seed:test` выполнены.
4. Приложение запущено.
5. Для internal endpoint'ов выставлено `ENABLE_INTERNAL_ENDPOINTS=true`.

Задать переменные:

```bash
export BASE_URL="http://localhost:3000"
export BASIC_AUTH_USERNAME="local"
export BASIC_AUTH_PASSWORD="local"
```

Проверить credentials явно:

```bash
curl -i "${BASE_URL}/api/vk/users/user-1/preferences" \
  -u "${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}" \
  -H "Accept: application/json"
```

Если credentials валидные и пользователя ещё нет, ожидается не `401`, а `404 not_found`.

### Curl: создать пользователя

```bash
curl -i -X POST "${BASE_URL}/internal/vk/users" \
  -u "${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "X-Request-Id: manual-create-user-1" \
  -d '{
    "userId": "user-1",
    "region": "EU"
  }'
```

### Curl: получить preferences

```bash
curl -i "${BASE_URL}/api/vk/users/user-1/preferences" \
  -u "${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}" \
  -H "Accept: application/json" \
  -H "X-Request-Id: manual-get-preferences-1"
```

### Curl: обновить preference

```bash
curl -i -X POST "${BASE_URL}/api/vk/users/user-1/preferences" \
  -u "${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "preferences": [
      {
        "notificationType": "marketing",
        "channel": "email",
        "allowed": true
      }
    ]
  }'
```

### Curl: evaluate

```bash
curl -i -X POST "${BASE_URL}/api/vk/evaluate" \
  -u "${BASIC_AUTH_USERNAME}:${BASIC_AUTH_PASSWORD}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "userId": "user-1",
    "notificationType": "marketing",
    "channel": "email",
    "region": "EU",
    "datetime": "2027-05-21T12:00:00Z"
  }'
```

## Формат ответов

Успешный ответ:

```json
{
  "data": {},
  "requestId": "req_1779604200123456789_a3f91c"
}
```

Ошибка:

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

## Бизнес-правила

Порядок принятия решения в evaluation:

1. Подходящая глобальная deny-политика.
2. Quiet hours, только для notification types с `respects_quiet_hours = true`.
3. Пользовательская настройка.
4. Дефолтная настройка.
5. Fallback deny.

Отсутствующие users, notification types и channels возвращают API-ошибку `404 not_found`, а не успешное deny-решение.

## Observability

`ObservabilityMiddleware` создаёт request context до guards/controllers:

- `requestId`
- `serviceId`
- опциональный `correlationId`

Заголовки:

- `X-Request-Id`: переиспользуется, если валиден, иначе генерируется новый.
- `X-Correlation-Id`: сохраняется в context, но не возвращается в API envelopes.

Сервис записывает структурированные events, counters и timers через `ObservabilityService`.

Текущий MVP sink:

```text
stdout / Nest application logger
```

Записываются:

- завершение/ошибка HTTP request и duration;
- service errors;
- Basic Auth failures и misconfiguration;
- изменения preferences;
- изменения quiet hours;
- notification decisions;
- counters и duration timers.

Observability неблокирующая: ошибки sink перехватываются и не должны ломать API responses или откатывать database operations.

## OpenAPI / Swagger UI / WebStorm

OpenAPI-контракт находится в:

```text
docs/openapi.yaml
```

Все enabled endpoint'ы описаны как защищённые Basic Auth.

Для WebStorm OpenAPI UI возможна ситуация, когда UI отображает curl с `Authorization`, но реальный request из кнопки `Execute` уходит без этого заголовка. В таком случае для проверки использовать:

- terminal curl;
- JetBrains HTTP Client;
- Postman / Insomnia.

Backend в этом случае ведёт себя корректно: обычный HTTP-запрос без `Authorization` должен получить `401 unauthorized`.

## Известные ограничения

- Basic Auth — MVP-компромисс, не production access-control model.
- Basic Auth вне локальной разработки должен работать только поверх HTTPS/TLS.
- Нет OAuth2/JWT/mTLS/service-to-service identity model.
- Нет rate limiting и brute-force protection.
- Нет production observability sink/exporter.
- Нет broker consumer для user/profile synchronization.
- Нет API управления глобальными политиками.
- Нет durable audit log storage.
- Нет admin UI.
- Нет deployment manifests.
- Текущие автоматизированные тесты не являются DB-backed e2e tests.

## Что улучшить для production

- Заменить Basic Auth на OAuth2/JWT, mTLS или другой service-to-service auth.
- Добавить rate limiting и brute-force protection.
- Добавить broker consumer для синхронизации пользователей.
- Добавить workflow управления глобальными политиками.
- Подключить OpenTelemetry, Prometheus, ClickHouse или внешний logging sink.
- Добавить alerting и dashboards.
- Добавить durable audit log storage.
- Ужесточить PII handling, например хешировать или псевдонимизировать user ids в telemetry.
- Добавить deployment manifests и production configuration hardening.
