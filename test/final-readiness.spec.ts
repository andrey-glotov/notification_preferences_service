const assert = require('node:assert/strict') as {
  ok(value: unknown, message?: string): void;
};
const { readFileSync } = require('node:fs') as {
  readFileSync(path: string, encoding: string): string;
};
const test = require('node:test') as (name: string, fn: () => void) => void;

const read = (path: string): string => readFileSync(path, 'utf8');

test('OpenAPI documents implemented endpoints and Basic Auth security scheme', () => {
  const openapi = read('docs/openapi.yaml');

  for (const expected of [
    '/internal/{ecosystemCode}/users:',
    '/api/{ecosystemCode}/users/{userId}/preferences:',
    '/api/{ecosystemCode}/evaluate:',
    'basicAuth:',
    'WWW-Authenticate:',
    'EvaluateNotificationEnvelope:',
    'UserPreferencesEnvelope:',
    'InternalUserEnvelope:',
  ]) {
    assert.ok(openapi.includes(expected), `${expected} is missing from OpenAPI`);
  }
});

test('README documents setup, security, API examples, observability, tests, and limitations', () => {
  const readme = read('README.md');

  for (const expected of [
    '## Быстрый запуск через Docker',
    '## Локальный запуск без контейнера приложения',
    '## Переменные окружения',
    'BASIC_AUTH_USERNAME',
    'ENABLE_INTERNAL_ENDPOINTS',
    'RUN_MIGRATIONS',
    '## Тесты',
    '## API-примеры',
    'POST /internal/:ecosystemCode/users',
    'POST /api/:ecosystemCode/evaluate',
    '## Observability',
    '## Известные ограничения',
    '## Что улучшить для production',
  ]) {
    assert.ok(readme.includes(expected), `${expected} is missing from README`);
  }
});

test('package exposes required build, test, migration, and seed scripts', () => {
  const packageJson = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
  };

  for (const script of ['build', 'test', 'drizzle:migrate', 'db:seed', 'db:seed:test']) {
    assert.ok(packageJson.scripts[script], `${script} script is missing`);
  }
});
