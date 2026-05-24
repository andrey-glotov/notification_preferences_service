import { test } from 'node:test';
import { ok } from 'node:assert/strict';
import {readFileSync} from 'node:fs';


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
    ok(openapi.includes(expected), `${expected} is missing from OpenAPI`);
  }
});

test('package exposes required build, test, migration, and seed scripts', () => {
  const packageJson = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
  };

  for (const script of ['build', 'test', 'drizzle:migrate', 'db:seed', 'db:seed:test']) {
    ok(packageJson.scripts[script], `${script} script is missing`);
  }
});
