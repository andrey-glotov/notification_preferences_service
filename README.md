# Notification Preferences Service

Blank Nest.js service with Drizzle ORM and PostgreSQL.

## Local start

```bash
cp .env.example .env
pnpm install
docker compose up --build
```

The application starts on `APP_PORT` and uses PostgreSQL from `docker-compose.yml`.

## Drizzle

```bash
pnpm run drizzle:generate
pnpm run drizzle:migrate
```

## Seeds

```bash
pnpm run db:seed
pnpm run db:seed:test
```
