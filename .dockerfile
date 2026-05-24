FROM node:24-alpine AS dependencies

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile


FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN pnpm run build


FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle.config.ts ./
COPY migrations ./migrations

EXPOSE 3000

CMD ["sh", "-c", "\
  if [ \"${RUN_MIGRATIONS:-true}\" = \"true\" ]; then pnpm run drizzle:migrate; fi && \
  if [ \"${RUN_SEEDS:-true}\" = \"true\" ]; then node dist/database/seeds/base.seed.js; fi && \
  if [ \"${RUN_TEST_SEEDS:-true}\" = \"true\" ]; then node dist/database/seeds/test.seed.js; fi && \
  exec node dist/main.js \
"]