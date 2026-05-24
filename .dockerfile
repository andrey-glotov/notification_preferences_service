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
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
